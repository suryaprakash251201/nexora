//! Shared tiny_http-based mock range server for integration tests.
#![allow(dead_code)]

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct MockFile {
    pub data: Vec<u8>,
    pub requests: AtomicUsize,
    pub ranges_served: Mutex<Vec<String>>,
    pub auth_seen: Mutex<Vec<Option<String>>>,
    pub accept_encoding_seen: Mutex<Vec<String>>,
    /// When true, the mock ignores Range and always returns 200 + full body.
    pub ignore_range: bool,
}

impl MockFile {
    fn handle(self: &Arc<Self>, req: tiny_http::Request) {
        self.requests.fetch_add(1, Ordering::SeqCst);

        let header = |name: &'static str| {
            req.headers()
                .iter()
                .find(|h| h.field.equiv(name))
                .map(|h| h.value.as_str().to_string())
        };
        let range = header("Range");
        let auth = header("Authorization");
        let enc = header("Accept-Encoding").unwrap_or_default();
        self.auth_seen.lock().unwrap().push(auth);
        self.accept_encoding_seen.lock().unwrap().push(enc);

        let (status, body): (u16, Vec<u8>) = if self.ignore_range || range.is_none() {
            (200, self.data.clone())
        } else if let Some(spec) = range.as_deref() {
            match parse_range(spec, self.data.len() as u64) {
                Some((s, e)) => {
                    self.ranges_served.lock().unwrap().push(format!("{s}-{e}"));
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

    pub fn hit_count(&self) -> usize {
        self.requests.load(Ordering::SeqCst)
    }

    pub fn served_ranges(&self) -> Vec<String> {
        self.ranges_served.lock().unwrap().clone()
    }
}

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
    let n: u64 = spec.parse().ok()?;
    Some((total.saturating_sub(n), total.saturating_sub(1)))
}

/// Spawns the mock; returns (base URL, state, stop flag).
pub fn spawn_mock(data: Vec<u8>, ignore_range: bool) -> (String, Arc<MockFile>, Arc<AtomicBool>) {
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

/// Deterministic pseudo-random byte pattern for test payloads.
pub fn test_data(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i * 31 % 251) as u8).collect()
}

/// Reader config with a specific chunk size/capacity for assertions.
pub fn cfg_for(chunk: u64, max_chunks: usize) -> nexora_audio::HttpRangeConfig {
    nexora_audio::HttpRangeConfig {
        chunk_size: chunk,
        max_chunks,
        connect_timeout: std::time::Duration::from_secs(5),
        timeout: std::time::Duration::from_secs(10),
        bearer_token: None,
    }
}
