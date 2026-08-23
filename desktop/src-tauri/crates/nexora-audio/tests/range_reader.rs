//! M1 acceptance tests for [`HttpRangeReader`].
//!
//! A tiny_http-based mock serves an in-memory "file" with real Range
//! semantics and records every request so tests can assert exactly what the
//! reader put on the wire.

use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nexora_audio::{HttpRangeConfig, HttpRangeReader, HttpSourceError};

/// Shared mock state.
struct MockFile {
    data: Vec<u8>,
    requests: AtomicUsize,
    ranges_served: Mutex<Vec<String>>,
    auth_seen: Mutex<Vec<Option<String>>>,
    accept_encoding_seen: Mutex<Vec<String>>,
    /// When true, the mock ignores Range and always returns 200 + full body.
    ignore_range: bool,
}

impl MockFile {
    fn handle(self: &Arc<Self>, req: tiny_http::Request) {
        self.requests.fetch_add(1, Ordering::SeqCst);

        let range = req
            .headers()
            .iter()
            .find(|h| h.field.equiv("Range"))
            .map(|h| h.value.as_str().to_string());
        let auth = req
            .headers()
            .iter()
            .find(|h| h.field.equiv("Authorization"))
            .map(|h| h.value.as_str().to_string());
        let enc = req
            .headers()
            .iter()
            .find(|h| h.field.equiv("Accept-Encoding"))
            .map(|h| h.value.as_str().to_string())
            .unwrap_or_default();
        self.auth_seen.lock().unwrap().push(auth);
        self.accept_encoding_seen.lock().unwrap().push(enc);

        let (status, body): (u16, Vec<u8>) = if self.ignore_range || range.is_none() {
            (200, self.data.clone())
        } else if let Some(spec) = range.as_deref() {
            match parse_range(spec, self.data.len() as u64) {
                Some((s, e)) => {
                    self.ranges_served
                        .lock()
                        .unwrap()
                        .push(format!("{s}-{e}"));
                    (206, self.data[s as usize..=(e as usize)].to_vec())
                }
                None => (416, b"range not satisfiable".to_vec()),
            }
        } else {
            unreachable!("previous branch handled none");
        };

        let mut resp = tiny_http::Response::from_data(body).with_status_code(status);
        if status == 206 {
            // Content-Range: "bytes S-E/TOTAL" — TOTAL is the resource size.
            let total = self.data.len() as u64;
            let served = self.ranges_served.lock().unwrap().last().cloned().unwrap();
            let (s, e) = served.split_once('-').unwrap();
            resp = resp.with_header(
                tiny_http::Header::from_bytes(
                    &b"Content-Range"[..],
                    format!("bytes {s}-{e}/{total}").as_bytes(),
                )
                .unwrap(),
            );
        }
        let _ = req.respond(resp);
    }

    fn hit_count(&self) -> usize {
        self.requests.load(Ordering::SeqCst)
    }
}

/// Parses `bytes=a-b` / `bytes=a-` / `bytes=-n`.
fn parse_range(spec: &str, total: u64) -> Option<(u64, u64)> {
    let spec = spec.strip_prefix("bytes=")?;
    if let Some((s, e)) = spec.split_once('-') {
        let start: u64 = s.parse().ok()?;
        if e.is_empty() {
            return Some((start, total.saturating_sub(1)));
        }
        let end: u64 = e.parse().ok()?;
        return Some((start, end.min(total - 1)));
    }
    // suffix form bytes=-N
    let n: u64 = spec.parse().ok()?;
    Some((total.saturating_sub(n), total.saturating_sub(1)))
}

/// Spawns the mock; returns base URL + state + stop flag.
fn spawn_mock(data: Vec<u8>, ignore_range: bool) -> (String, Arc<MockFile>, Arc<AtomicBool>) {
    let state = Arc::new(MockFile {
        data,
        requests: AtomicUsize::new(0),
        ranges_served: Mutex::new(Vec::new()),
        auth_seen: Mutex::new(Vec::new()),
        accept_encoding_seen: Mutex::new(Vec::new()),
        ignore_range,
    });
    let stop = Arc::new(AtomicBool::new(false));
    let server = tiny_http::Server::http("127.0.0.1:0").expect("bind mock server");
    let port = server.server_addr().to_ip().unwrap().port();
    {
        let state = Arc::clone(&state);
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                // Poll-style recv so the thread can observe `stop`.
                match server.recv_timeout(Duration::from_millis(50)) {
                    Ok(Some(req)) => state.handle(req),
                    Ok(None) => {}
                    Err(_) => break,
                }
            }
        });
    }
    (format!("http://127.0.0.1:{port}/file.bin"), state, stop)
}

fn test_data(len: usize) -> Vec<u8> {
    // Deterministic pseudo-random pattern (not uniform), easy to assert.
    (0..len).map(|i| (i * 31 % 251) as u8).collect()
}

fn cfg_for(chunk: u64, max_chunks: usize) -> HttpRangeConfig {
    HttpRangeConfig {
        chunk_size: chunk,
        max_chunks,
        connect_timeout: Duration::from_secs(5),
        timeout: Duration::from_secs(10),
        bearer_token: None,
    }
}

// ── 1. open discovers length; sequential read returns exact bytes ──────────
#[test]
fn open_discovers_length_and_sequential_read_is_exact() {
    let data = test_data(700_000); // spans multiple default-size chunks? we use small chunks below
    let (url, _state, _stop) = spawn_mock(data.clone(), false);

    let mut r =
        HttpRangeReader::open_with(&url, cfg_for(64 * 1024, 64)).expect("open");
    assert_eq!(r.len() as usize, data.len());

    let mut out = Vec::new();
    r.read_to_end(&mut out).expect("read_to_end");
    if out != data {
        let mut i = 0;
        while i < out.len().min(data.len()) && out[i] == data[i] { i += 1; }
        panic!("content differs first at byte {} (out.len={} data.len={}): served={:?}",
            i, out.len(), data.len(), _state.ranges_served.lock().unwrap());
    }
}

// ── 2. backward seek within cached chunk costs zero requests ───────────────
#[test]
fn seek_within_cached_chunk_avoids_network() {
    let data = test_data(256 * 1024); // exactly one chunk at 256 KiB
    let (url, state, _stop) = spawn_mock(data.clone(), false);

    let mut r = HttpRangeReader::open_with(&url, cfg_for(256 * 1024, 8)).unwrap();

    let mut buf = [0u8; 100];
    r.read_exact(&mut buf).unwrap();
    assert_eq!(&buf[..], &data[..100]);
    let after_first = state.hit_count();

    // Backward seek inside the same chunk → cache hit, no new request.
    r.seek(SeekFrom::Start(10)).unwrap();
    r.read_exact(&mut buf).unwrap();
    assert_eq!(&buf[..], &data[10..110]);
    assert_eq!(state.hit_count(), after_first);
    let (hits, misses) = r.stats();
    assert_eq!((hits, misses), (2, 1)); // first read miss, two hits after

    // Forward seek still inside chunk → also free.
    r.seek(SeekFrom::Current(5)).unwrap(); // → 115
    let mut one = [0u8; 1];
    r.read_exact(&mut one).unwrap();
    assert_eq!(one[0], data[115]);
    assert_eq!(state.hit_count(), after_first);
}

// ── 3. far-forward seek fetches only the needed chunk ──────────────────────
#[test]
fn far_seek_fetches_target_chunk_only() {
    let chunk = 4096u64;
    let data = test_data(chunk as usize * 8);
    let (url, state, _stop) = spawn_mock(data.clone(), false);

    let mut r = HttpRangeReader::open_with(&url, cfg_for(chunk, 16)).unwrap();

    // Read one byte from chunk 6 directly.
    let target = (chunk * 6 + 7) as usize;
    r.seek(SeekFrom::Start(target as u64)).unwrap();
    let mut one = [0u8; 1];
    r.read_exact(&mut one).unwrap();
    assert_eq!(one[0], data[target]);

    // Requests: 1 open probe + 1 chunk fetch (no intermediate chunks).
    assert!(
        state.hit_count() <= 3,
        "expected ≤3 requests, got {}",
        state.hit_count()
    );

    let served = state.ranges_served.lock().unwrap();
    assert!(
        served.iter().any(|rg| rg.starts_with(&format!("{}", chunk * 6))),
        "a request for chunk 6 should appear; served={served:?}"
    );
}

// ── 4. reads spanning chunk boundaries are seamless ────────────────────────
#[test]
fn boundary_spanning_reads_are_seamless() {
    let chunk = 1024u64;
    let data = test_data(chunk as usize * 4);
    let (url, _state, _stop) = spawn_mock(data.clone(), false);

    let mut r = HttpRangeReader::open_with(&url, cfg_for(chunk, 8)).unwrap();
    // Start mid-chunk-1, read across chunk boundaries without hitting EOF.
    let start = 1500usize;
    let want_len = 2400usize; // ends at 3900 < 4096
    r.seek(SeekFrom::Start(start as u64)).unwrap();
    let mut out = vec![0u8; want_len];
    r.read_exact(&mut out).unwrap();
    assert_eq!(out, data[start..start + want_len]);
}

// ── 5. EOF semantics ───────────────────────────────────────────────────────
#[test]
fn eof_returns_zero_and_seek_clamps_to_end() {
    let data = test_data(5000);
    let (url, _state, _stop) = spawn_mock(data.clone(), false);

    let mut r = HttpRangeReader::open_with(&url, cfg_for(2048, 8)).unwrap();
    r.seek(SeekFrom::End(-3)).unwrap();
    let pos = r.stream_position().unwrap();
    assert_eq!(pos, 4997);

    let mut out = Vec::new();
    r.read_to_end(&mut out).unwrap();
    assert_eq!(out.len(), 3);
    assert_eq!(out, data[4997..]);

    // At EOF further reads yield Ok(0).
    let mut scratch = [0u8; 4];
    assert_eq!(r.read(&mut scratch).unwrap(), 0);

    // Seeking past end clamps to len.
    let clamped = r.seek(SeekFrom::Start(999_999)).unwrap();
    assert_eq!(clamped, 5000);
}

// ── 6. LRU eviction forces refetch of evicted chunk ────────────────────────
#[test]
fn lru_eviction_refetches_evicted_chunk() {
    let chunk = 1024u64;
    let data = test_data(chunk as usize * 4);
    let (url, state, _stop) = spawn_mock(data.clone(), false);

    // Cache holds ONE chunk: every non-sequential jump must refetch.
    let mut r = HttpRangeReader::open_with(&url, cfg_for(chunk, 1)).unwrap();

    let mut byte = [0u8; 1];
    r.seek(SeekFrom::Start(0)).unwrap();
    r.read_exact(&mut byte).unwrap(); // warms chunk 0
    let baseline = state.hit_count();

    r.seek(SeekFrom::Start(chunk * 2)).unwrap(); // jumps to chunk 2 (evicts 0)
    r.read_exact(&mut byte).unwrap();
    assert_eq!(byte[0], data[(chunk * 2) as usize]);

    r.seek(SeekFrom::Start(1)).unwrap(); // back to chunk 0 → must refetch
    r.read_exact(&mut byte).unwrap();
    assert_eq!(byte[0], data[1]);
    assert!(
        state.hit_count() > baseline,
        "evicted chunk should trigger a refetch"
    );
}

// ── 7. prefetch_tail makes EOF-region reads free ───────────────────────────
#[test]
fn prefetch_tail_warms_end_region() {
    let chunk = 1024u64;
    let data = test_data(chunk as usize * 6);
    let (url, state, _stop) = spawn_mock(data.clone(), false);

    let r = HttpRangeReader::open_with(&url, cfg_for(chunk, 16)).unwrap();
    let before = state.hit_count();

    let warmed = r.prefetch_tail(2500).unwrap();
    assert_eq!(warmed, 2500);

    let after_open_warmup = state.hit_count();
    // Now read the very last byte: must be fully cached.
    let mut rr = r;
    rr.seek(SeekFrom::End(-1)).unwrap();
    let mut last = [0u8; 1];
    rr.read_exact(&mut last).unwrap();
    assert_eq!(last[0], *data.last().unwrap());
    assert_eq!(
        state.hit_count(),
        after_open_warmup,
        "tail read should cost zero requests"
    );
    let _ = before;
}

// ── 8. auth header is forwarded on every request ───────────────────────────
#[test]
fn bearer_token_is_sent() {
    let data = test_data(2048);
    let (url, state, _stop) = spawn_mock(data.clone(), false);

    let cfg = HttpRangeConfig {
        chunk_size: 1024,
        max_chunks: 4,
        connect_timeout: Duration::from_secs(5),
        timeout: Duration::from_secs(10),
        bearer_token: Some("secret-token-123".into()),
    };
    let mut r = HttpRangeReader::open_with(&url, cfg).unwrap();
    let mut all = Vec::new();
    r.read_to_end(&mut all).unwrap();
    assert_eq!(all, data);

    let seen = state.auth_seen.lock().unwrap();
    assert!(!seen.is_empty(), "mock saw no requests");
    assert!(
        seen.iter().all(|a| a.as_deref() == Some("Bearer secret-token-123")),
        "every request must carry the bearer token; seen={seen:?}"
    );
}

// ── 9. Accept-Encoding identity is enforced ────────────────────────────────
#[test]
fn accept_encoding_identity_enforced() {
    let data = test_data(2048);
    let (url, state, _stop) = spawn_mock(data.clone(), false);

    let mut r = HttpRangeReader::open_with(&url, cfg_for(1024, 4)).unwrap();
    let mut all = Vec::new();
    r.read_to_end(&mut all).unwrap();

    let seen = state.accept_encoding_seen.lock().unwrap();
    assert!(
        !seen.is_empty() && seen.iter().all(|e| e == "identity"),
        "all requests must pin Accept-Encoding: identity; seen={seen:?}"
    );
}

// ── 10. servers ignoring Range are rejected at open ────────────────────────
#[test]
fn range_unsupported_server_rejected_at_open() {
    let data = test_data(4096);
    let (url, _state, _stop) = spawn_mock(data, true);

    let err = match HttpRangeReader::open_with(&url, cfg_for(1024, 4)) {
        Err(e) => e,
        Ok(_) => panic!("open must fail against a range-ignoring server"),
    };
    assert!(
        matches!(err, HttpSourceError::RangeUnsupported(_)),
        "want RangeUnsupported, got {err:?}"
    );
}

// ── 11. interleaved read/seek stress vs reference implementation ───────────
#[test]
fn randomized_ops_match_reference_semantics() {
    let chunk = 512u64;
    let data = test_data(chunk as usize * 10);
    let (url, _state, _stop) = spawn_mock(data.clone(), false);

    use std::cell::RefCell;
    struct Ref<'a> {
        data: &'a [u8],
        pos: u64,
    }
    impl<'a> Ref<'a> {
        fn read(&mut self, buf: &mut [u8]) -> usize {
            let n = buf
                .len()
                .min((self.data.len() as u64).saturating_sub(self.pos) as usize);
            buf[..n].copy_from_slice(&self.data[self.pos as usize..self.pos as usize + n]);
            self.pos += n as u64;
            n
        }
    }

    let mut r = HttpRangeReader::open_with(&url, cfg_for(chunk, 4)).unwrap();
    let refcell = RefCell::new(Ref { data: &data, pos: 0 });

    let mut rng_state = 0x12345678u64;
    let mut rand = move || {
        rng_state ^= rng_state << 13;
        rng_state ^= rng_state >> 7;
        rng_state ^= rng_state << 17;
        rng_state
    };

    let mut buf = [0u8; 97]; // prime-ish size to straddle boundaries oddly
    for step in 0..600 {
        let op = rand() % 100;
        let mut refr = refcell.borrow_mut();
        if op < 45 {
            // read
            let got = r.read(&mut buf).unwrap();
            let want = refr.read(&mut buf);
            assert_eq!(got, want, "step {step}: read length mismatch");
            assert_eq!(&buf[..got], &refr.data[refr.pos as usize - got..refr.pos as usize]);
        } else if op < 80 {
            // absolute seek
            let target = rand() % (data.len() as u64 + 10);
            let p = r.seek(SeekFrom::Start(target)).unwrap();
            refr.pos = refr.data.len().min(target as usize) as u64;
            assert_eq!(p, refr.pos, "step {step}: seek position mismatch");
        } else {
            // relative seek
            let d = (rand() % 2000) as i64 - 1000;
            let cur = r.stream_position().unwrap();
            let want = (cur as i64 + d).clamp(0, data.len() as i64) as u64;
            let p = r.seek(SeekFrom::Current(d)).unwrap();
            assert_eq!(p, want, "step {step}: relative seek mismatch");
            refr.pos = want;
        }
    }
}
