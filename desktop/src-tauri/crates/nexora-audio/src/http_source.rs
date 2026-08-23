//! `HttpRangeReader` — an `io::Read + io::Seek` over HTTP byte-range requests.
//!
//! Design goals (docs/native-audio-plan.md):
//! - symphonia drives us: it issues sequential reads plus arbitrary seeks
//!   (MP4 sample-table walks can jump anywhere, including near EOF when the
//!   moov atom sits at the end). We must service any seek cheaply.
//! - Bounded memory: a fixed-count LRU of fixed-size chunks is the ONLY
//!   retained data.
//! - One-chunk read-ahead on a background thread keeps symphonia's forward
//!   scans off the HTTP request path.
//!
//! Byte-offset correctness notes:
//! - Every request sends `Accept-Encoding: identity`; a transparently gzipped
//!   body would desynchronize our offsets from the server's.
//! - Servers that ignore Range (200 instead of 206) are rejected at open time
//!   rather than silently corrupting the stream.
//! - Open performs exactly one `GET Range: bytes=0-0`: the 206 response's
//!   `Content-Range: bytes 0-0/LEN` yields both length support proof and
//!   total size without an extra HEAD round-trip.

use std::collections::{HashMap, VecDeque};
use std::io::{self, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(feature = "decode")]
use symphonia::core::io::MediaSource as SymMediaSource;

/// Errors surfaced by [`HttpRangeReader`].
#[derive(Debug, thiserror::Error)]
pub enum HttpSourceError {
    /// The server did not honor a Range request (200 full-body instead of 206).
    #[error("server does not support HTTP range requests ({0})")]
    RangeUnsupported(String),
    /// The server response could not be interpreted (bad Content-Range etc.).
    #[error("malformed server response: {0}")]
    MalformedResponse(String),
    /// Transport-level failure (DNS, connect, timeout, status code). Boxed:
    /// `ureq::Error` is large and would bloat every `Result` in this module.
    #[error("http error: {0}")]
    Http(#[from] Box<ureq::Error>),
    /// Underlying I/O failure while reading a response body.
    #[error("i/o error: {0}")]
    Io(#[from] io::Error),
}

impl From<HttpSourceError> for io::Error {
    fn from(e: HttpSourceError) -> Self {
        match e {
            HttpSourceError::Io(io) => io,
            other => io::Error::other(other.to_string()),
        }
    }
}

/// Tunables for a reader instance.
#[derive(Clone)]
pub struct HttpRangeConfig {
    /// Bytes per cached chunk. 256 KiB balances request count vs granularity.
    pub chunk_size: u64,
    /// Maximum number of resident chunks (LRU-evicted beyond this).
    pub max_chunks: usize,
    /// Connection timeout.
    pub connect_timeout: Duration,
    /// Per-request timeout.
    pub timeout: Duration,
    /// Optional bearer token sent as `Authorization: Bearer <token>`.
    pub bearer_token: Option<String>,
}

impl Default for HttpRangeConfig {
    fn default() -> Self {
        Self {
            chunk_size: 256 * 1024,
            max_chunks: 256, // 256 * 256 KiB = 64 MiB
            connect_timeout: Duration::from_secs(10),
            timeout: Duration::from_secs(60),
            bearer_token: None,
        }
    }
}

struct Cache {
    chunks: HashMap<u64, Arc<Vec<u8>>>,
    order: VecDeque<u64>, // LRU: front = oldest
    max_chunks: usize,
    cursor: u64,
    hits: u64,
    misses: u64,
}

impl Cache {
    fn new(max_chunks: usize) -> Self {
        Self {
            chunks: HashMap::new(),
            order: VecDeque::new(),
            max_chunks,
            cursor: 0,
            hits: 0,
            misses: 0,
        }
    }

    fn get(&mut self, idx: u64) -> Option<Arc<Vec<u8>>> {
        match self.chunks.get(&idx) {
            Some(c) => {
                self.hits += 1;
                let c = c.clone();
                self.touch(idx);
                Some(c)
            }
            None => {
                self.misses += 1;
                None
            }
        }
    }

    fn insert(&mut self, idx: u64, data: Arc<Vec<u8>>, protect: u64) {
        if self.chunks.len() >= self.max_chunks {
            // Evict the LRU entry that is neither the protected chunk nor the
            // incoming one. If everything qualifies as protected, allow a
            // temporary overflow — correctness beats strictness here.
            for _ in 0..self.order.len() {
                let victim = match self.order.front() {
                    Some(v) => *v,
                    None => break,
                };
                if victim == protect || victim == idx || !self.chunks.contains_key(&victim) {
                    self.order.pop_front();
                    self.order.push_back(victim); // rotate to back, try next
                    continue;
                }
                self.order.pop_front();
                self.chunks.remove(&victim);
                break;
            }
        }
        self.chunks.insert(idx, data);
        if let Some(pos) = self.order.iter().position(|&c| c == idx) {
            self.order.remove(pos);
        }
        self.order.push_back(idx);
    }

    #[inline]
    fn touch(&mut self, idx: u64) {
        if let Some(pos) = self.order.iter().position(|&c| c == idx) {
            self.order.remove(pos);
            self.order.push_back(idx);
        }
    }
}

/// Streaming byte source over an HTTP endpoint that honors `Range` requests.
///
/// Cheap to share: internals live behind one `Arc`, so read-ahead threads and
/// (later) the decoder thread can hold handles without lifetimes leaking.
pub struct HttpRangeReader {
    inner: Arc<Inner>,
}

struct Inner {
    url: String,
    agent: ureq::Agent,
    bearer_token: Option<String>,
    len: u64,
    chunk_size: u64,
    cache: Mutex<Cache>,
    /// Chunk indexes currently being fetched by read-ahead threads.
    inflight: Mutex<std::collections::HashSet<u64>>,
    total_requests: AtomicU64,
}

impl HttpRangeReader {
    /// Opens the URL. Issues a single `GET Range: bytes=0-0` to verify range
    /// support and discover total length.
    pub fn open(url: impl Into<String>) -> Result<Self, HttpSourceError> {
        Self::open_with(url, HttpRangeConfig::default())
    }

    pub fn open_with(url: impl Into<String>, cfg: HttpRangeConfig) -> Result<Self, HttpSourceError> {
        let url = url.into();
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(cfg.connect_timeout)
            .timeout_read(cfg.timeout)
            .redirects(5)
            .build();

        let mut req = agent
            .get(&url)
            .set("Accept-Encoding", "identity")
            .set("Range", "bytes=0-0");
        if let Some(token) = &cfg.bearer_token {
            req = req.set("Authorization", &format!("Bearer {token}"));
        }
        let resp = req.call().map_err(Box::new)?;
        let status = resp.status();
        match status {
            206 => {}
            200 => {
                return Err(HttpSourceError::RangeUnsupported(url));
            }
            s => {
                return Err(HttpSourceError::MalformedResponse(format!(
                    "unexpected status {s} opening {url}"
                )));
            }
        }
        let cr = resp.header("Content-Range").ok_or_else(|| {
            HttpSourceError::MalformedResponse("206 without Content-Range".into())
        })?;
        let len = parse_content_range_total(cr).ok_or_else(|| {
            HttpSourceError::MalformedResponse(format!("bad Content-Range: {cr}"))
        })?;
        // Drain the single body byte so the connection returns to the pool.
        let mut drain = resp.into_reader();
        std::io::copy(&mut drain, &mut std::io::sink())?;

        Ok(Self {
            inner: Arc::new(Inner {
                url,
                agent,
                bearer_token: cfg.bearer_token,
                len,
                chunk_size: cfg.chunk_size,
                cache: Mutex::new(Cache::new(cfg.max_chunks)),
                inflight: Mutex::new(std::collections::HashSet::new()),
                total_requests: AtomicU64::new(0),
            }),
        })
    }

    /// Total resource length in bytes.
    pub fn len(&self) -> u64 {
        self.inner.len
    }

    /// True when the resource reported zero length.
    pub fn is_empty(&self) -> bool {
        self.inner.len == 0
    }

    /// Endpoint URL.
    pub fn url(&self) -> &str {
        &self.inner.url
    }

    /// (chunk_hits, chunk_misses) since open.
    pub fn stats(&self) -> (u64, u64) {
        let c = self.inner.cache.lock().expect("cache lock poisoned");
        (c.hits, c.misses)
    }

    /// Total HTTP requests issued since open (diagnostics/tests).
    pub fn http_requests(&self) -> u64 {
        self.inner.total_requests.load(Ordering::Relaxed)
    }

    /// Warms the final `bytes` of the resource (moov-at-end handling): the
    /// covering chunks are fetched synchronously so later EOF-region reads
    /// cost zero requests. Returns the number of bytes now resident.
    pub fn prefetch_tail(&self, bytes: u64) -> io::Result<u64> {
        let want = bytes.min(self.inner.len);
        if want == 0 {
            return Ok(0);
        }
        let start = self.inner.len - want;
        let first = start / self.inner.chunk_size;
        let last = (self.inner.len - 1) / self.inner.chunk_size;
        let mut warmed = 0u64;
        for idx in first..=last {
            let cs = idx * self.inner.chunk_size;
            let ce = ((idx + 1) * self.inner.chunk_size).min(self.inner.len);
            let have = {
                let c = self.inner.cache.lock().expect("cache lock poisoned");
                c.chunks.contains_key(&idx)
            };
            // Count only the overlap with the requested tail window.
            let overlap = ce.saturating_sub(cs.max(start));
            if !have {
                self.inner.fetch_chunk_sync(idx)?;
            }
            warmed += overlap;
        }
        Ok(warmed)
    }
}

impl Inner {
    fn request_range(&self, start: u64, end_incl: u64) -> Result<Vec<u8>, HttpSourceError> {
        let mut req = self
            .agent
            .get(&self.url)
            .set("Accept-Encoding", "identity")
            .set("Range", &format!("bytes={start}-{end_incl}"))
            .timeout(Duration::from_secs(60));
        if let Some(token) = &self.bearer_token {
            req = req.set("Authorization", &format!("Bearer {token}"));
        }
        let resp = req.call().map_err(Box::new)?;
        self.total_requests.fetch_add(1, Ordering::Relaxed);
        match resp.status() {
            206 => {
                let expected = (end_incl - start + 1) as usize;
                let mut body = Vec::with_capacity(expected);
                resp.into_reader()
                    .take(expected as u64)
                    .read_to_end(&mut body)?;
                if body.len() != expected {
                    return Err(HttpSourceError::MalformedResponse(format!(
                        "short range body: got {} want {expected}",
                        body.len()
                    )));
                }
                Ok(body)
            }
            200 => Err(HttpSourceError::RangeUnsupported(self.url.clone())),
            s => Err(HttpSourceError::MalformedResponse(format!(
                "unexpected status {s} for range {start}-{end_incl}"
            ))),
        }
    }

    /// Fetches one chunk and inserts it (protected while being consumed).
    fn fetch_chunk_sync(&self, idx: u64) -> Result<(), HttpSourceError> {
        let start = idx * self.chunk_size;
        let end_incl = ((idx + 1) * self.chunk_size)
            .saturating_sub(1)
            .min(self.len - 1);
        let data = Arc::new(self.request_range(start, end_incl)?);
        let mut c = self.cache.lock().expect("cache lock poisoned");
        c.insert(idx, data, idx);
        Ok(())
    }

    /// Background read-ahead for `idx`. Best-effort: failures are dropped —
    /// the next synchronous read retries through the normal path.
    ///
    /// Takes `&Arc<Self>` because the spawned thread owns a clone.
    fn spawn_readahead(self: &Arc<Inner>, idx: u64) {
        {
            let mut inflight = self.inflight.lock().expect("inflight lock poisoned");
            if !inflight.insert(idx) {
                return; // already being fetched
            }
        }
        let this = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("nexora-audio-readahead".into())
            .spawn(move || {
                let res = this.fetch_chunk_sync(idx);
                let mut inflight = this.inflight.lock().expect("inflight lock poisoned");
                inflight.remove(&idx);
                drop(res); // swallowed by design
            });
        if spawned.is_err() {
            // Could not spawn: dedup guard would leak the index forever.
            let mut inflight = self.inflight.lock().expect("inflight lock poisoned");
            inflight.remove(&idx);
        }
    }
}

impl Read for HttpRangeReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }

        let mut filled = 0usize;
        enum Act {
            /// Copy already done under lock; optionally warm this chunk next.
            Copied(Option<u64>),
            /// Chunk missing: fetch it synchronously, then warm `next`.
            Fetch { idx: u64, warm: Option<u64> },
            /// Cursor hit EOF.
            Eof,
        }

        while filled < buf.len() {
            // ── Decide + copy strictly under the lock, nothing else. ──
            let act = {
                let mut c = self.inner.cache.lock().expect("cache lock poisoned");
                if c.cursor >= self.inner.len {
                    Act::Eof
                } else {
                    let idx = c.cursor / self.inner.chunk_size;
                    let off = (c.cursor % self.inner.chunk_size) as usize;
                    match c.get(idx) {
                        Some(chunk) => {
                            let avail = chunk.len().saturating_sub(off);
                            if avail == 0 {
                                // Fully-consumed short tail chunk → EOF.
                                c.cursor = self.inner.len;
                                Act::Eof
                            } else {
                                let n = avail.min(buf.len() - filled);
                                buf[filled..filled + n]
                                    .copy_from_slice(&chunk[off..off + n]);
                                filled += n;
                                c.cursor += n as u64;
                                let warm_next =
                                    c.cursor.is_multiple_of(self.inner.chunk_size)
                                        && c.cursor < self.inner.len;
                                Act::Copied(warm_next.then(|| c.cursor / self.inner.chunk_size))
                            }
                        }
                        None => {
                            let warm = {
                                let nxt = idx + 1;
                                (nxt * self.inner.chunk_size < self.inner.len).then_some(nxt)
                            };
                            Act::Fetch { idx, warm }
                        }
                    }
                }
            }; // guard released here

            // ── Act without holding the lock. ──
            match act {
                Act::Copied(Some(next)) => self.inner.spawn_readahead(next),
                Act::Copied(None) => {}
                Act::Fetch { idx, warm } => {
                    self.inner.fetch_chunk_sync(idx)?;
                    if let Some(next) = warm {
                        self.inner.spawn_readahead(next);
                    }
                }
                Act::Eof => return Ok(filled),
            }
        }
        Ok(filled)
    }
}

impl Seek for HttpRangeReader {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let mut cache = self.inner.cache.lock().expect("cache lock poisoned");
        let target = match pos {
            SeekFrom::Start(p) => p as i128,
            SeekFrom::Current(d) => cache.cursor as i128 + d as i128,
            SeekFrom::End(d) => self.inner.len as i128 + d as i128,
        };
        cache.cursor = target.clamp(0, self.inner.len as i128) as u64;
        Ok(cache.cursor)
    }
}

/// Parses total length out of a `Content-Range: bytes S-E/T` header value.
fn parse_content_range_total(value: &str) -> Option<u64> {
    let total = value.rsplit('/').next()?.trim();
    if total.eq_ignore_ascii_case("*") {
        return None;
    }
    total.parse().ok()
}

// ── symphonia integration ───────────────────────────────────────────────────
// With the `decode` feature, HttpRangeReader plugs straight into
// MediaSourceStream as a seekable source of known length.
#[cfg(feature = "decode")]
impl SymMediaSource for HttpRangeReader {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        Some(self.len())
    }
}

