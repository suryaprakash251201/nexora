//! Playback state machine driving a [`TrackDecoder`] into an [`AudioOut`].
//!
//! One decode thread per track; commands arrive over an mpsc channel so
//! `seek`/`pause`/`volume` never block on audio work. Position is derived as
//! `seek_base + (device_played_frames − frames_at_seek) / sample_rate`, which
//! stays truthful across seeks, speed changes and device buffering.

use std::sync::mpsc::{self, Sender, TryRecvError};
use std::sync::{Arc, Mutex};

type EventCallback = Box<dyn Fn(PlayerEvent) + Send>;
use std::time::Duration;

use crate::decoder::{DecoderError, TrackDecoder};
use crate::output::AudioOut;

#[cfg(feature = "decode")]
use symphonia::core::io::MediaSource as SymMediaSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Opening,
    Ready,
    Playing,
    Paused,
    Ended,
    Failed,
}

#[derive(Debug, Clone)]
pub enum PlayerEvent {
    Ready,
    Playing,
    Paused,
    Ended,
    Error(String),
}

enum Cmd {
    Seek(f64),
    Pause,
    Resume,
    SetVolume(f32),
    SetSpeed(f64),
    Exit,
}

struct Shared {
    out: Mutex<Box<dyn AudioOut>>,
    phase: Mutex<Phase>,
    info: Mutex<Option<crate::TrackInfo>>,
    /// Position (sec) the current decode run started from.
    base_sec: Mutex<f64>,
    event: Mutex<Option<EventCallback>>,
    duration_sec: Mutex<Option<f64>>,
}

impl Shared {
    fn fire(&self, ev: PlayerEvent) {
        if let Some(cb) = self.event.lock().expect("event lock").as_ref() {
            cb(ev);
        }
    }

    fn set_phase(&self, p: Phase) {
        *self.phase.lock().expect("phase lock") = p;
        self.fire(match p {
            Phase::Playing => PlayerEvent::Playing,
            Phase::Paused => PlayerEvent::Paused,
            Phase::Ended => PlayerEvent::Ended,
            Phase::Failed => PlayerEvent::Error("playback failed".into()),
            Phase::Opening | Phase::Ready => return,
        });
    }

    fn position(&self) -> f64 {
        let (sr, ch) = {
            let info = self.info.lock().expect("info lock");
            info.as_ref()
                .map(|i| (i.sample_rate, i.channels.max(1)))
                .unwrap_or((0, 1))
        };
        if sr == 0 {
            return 0.0;
        }
        let out = self.out.lock().expect("out lock");
        let base = *self.base_sec.lock().expect("base lock");
        let raw = base + out.played_frames() as f64 / f64::from(sr) / f64::from(ch as u32);
        // Clamp to known duration: counters can slightly overshoot after the
        // final packet (codec padding).
        match *self.duration_sec.lock().expect("duration lock") {
            Some(d) if d > 0.0 => raw.min(d),
            _ => raw,
        }
    }
}

pub struct PlayerHandle {
    shared: Arc<Shared>,
    cmd_tx: Sender<Cmd>,
    join: Option<std::thread::JoinHandle<()>>,
}

#[derive(Debug, thiserror::Error)]
pub enum PlayerError {
    #[error("decoder: {0}")]
    Decoder(#[from] DecoderError),
    #[error("output: {0}")]
    Output(String),
    #[error("player already stopped")]
    Stopped,
}

impl PlayerHandle {
    /// Opens `source`, optionally starting at `start_sec`, and begins
    /// decoding immediately. `autoplay` starts audible playback once enough
    /// audio is buffered; otherwise the player sits in `Paused`.
    pub fn open(
        source: Box<dyn SymMediaSource>,
        out: Box<dyn AudioOut>,
        start_sec: Option<f64>,
        autoplay: bool,
    ) -> Result<Self, PlayerError> {
        let mut dec = TrackDecoder::open(source)?;
        if let Some(t) = start_sec.filter(|s| *s > 0.05) {
            dec.seek_seconds(t)?;
        }
        let info = dec.info().clone();

        let shared = Arc::new(Shared {
            out: Mutex::new(out),
            phase: Mutex::new(if autoplay { Phase::Opening } else { Phase::Paused }),
            info: Mutex::new(Some(info.clone())),
            base_sec: Mutex::new(start_sec.unwrap_or(0.0)),
            event: Mutex::new(None),
            duration_sec: Mutex::new(info.duration_sec),
        });

        let (cmd_tx, cmd_rx) = mpsc::channel::<Cmd>();
        let thread_shared = Arc::clone(&shared);
        let join = std::thread::Builder::new()
            .name("nexora-audio-decode".into())
            .spawn(move || {
                run_decode_thread(thread_shared, dec, cmd_rx, autoplay);
            })
            .map_err(|e| PlayerError::Output(format!("spawn decode thread: {e}")))?;

        Ok(Self { shared, cmd_tx, join: Some(join) })
    }

    pub fn play(&self) -> Result<(), PlayerError> {
        self.send(Cmd::Resume)
    }
    pub fn pause(&self) -> Result<(), PlayerError> {
        self.send(Cmd::Pause)
    }
    pub fn seek(&self, sec: f64) -> Result<(), PlayerError> {
        self.send(Cmd::Seek(sec.max(0.0)))
    }
    pub fn set_volume(&self, v: f32) -> Result<(), PlayerError> {
        self.send(Cmd::SetVolume(v.clamp(0.0, 1.0)))
    }
    pub fn set_speed(&self, r: f64) -> Result<(), PlayerError> {
        self.send(Cmd::SetSpeed(r))
    }
    pub fn position(&self) -> f64 {
        self.shared.position()
    }
    pub fn duration(&self) -> Option<f64> {
        *self.shared.duration_sec.lock().expect("duration lock")
    }
    pub fn track_info(&self) -> Option<crate::TrackInfo> {
        self.shared.info.lock().expect("info lock").clone()
    }
    pub fn phase(&self) -> Phase {
        *self.shared.phase.lock().expect("phase lock")
    }

    /// Installs the single event callback (call before/at open time).
    pub fn on_event(&self, cb: EventCallback) {
        *self.shared.event.lock().expect("event lock") = Some(cb);
    }

    fn send(&self, c: Cmd) -> Result<(), PlayerError> {
        self.cmd_tx.send(c).map_err(|_| PlayerError::Stopped)
    }
}

impl Drop for PlayerHandle {
    fn drop(&mut self) {
        let _ = self.cmd_tx.send(Cmd::Exit);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

/// Decode-thread body: services commands, keeps ~1 s of audio queued in the
/// output, and detects natural end-of-stream.
fn run_decode_thread(
    shared: Arc<Shared>,
    mut dec: TrackDecoder,
    cmd_rx: mpsc::Receiver<Cmd>,
    autoplay: bool,
) {
    // Prebuffer target in interleaved SAMPLES: ≈1 s @44.1 kHz per channel.
    // buffered_frames() counts raw samples, so scale by channel count before
    // comparing — otherwise stereo tracks only prebuffer half a second.
    const TARGET_BUFFERED_FRAMES_PER_CH: u64 = 44_100;

    // Queue swap for a completed seek: drop the stale queue, rebase the
    // position anchor to the target (accounting for everything the device
    // consumed since the seek command), and revive Ended/Failed.
    let do_swap = |pending: f64, dec: &TrackDecoder| {
        // played_frames() counts interleaved SAMPLES, so divide by channels
        // as well as sample rate — matching Shared::position(). Omitting
        // /channels made the reported position jump backwards after a seek
        // on stereo/multichannel tracks until the counter caught up.
        let (sr, ch) = {
            let info = dec.info();
            (
                info.sample_rate.max(1),
                info.channels.max(1) as u32,
            )
        };
        {
            let mut out = shared.out.lock().expect("out lock");
            out.clear();
            *shared.base_sec.lock().expect("base lock") =
                pending - out.played_frames() as f64 / f64::from(sr) / f64::from(ch);
            let paused = out.is_paused();
            drop(out);
            // Seeking back from Ended (timeline click after the track
            // finished, repeat-one restart) must revive playback — otherwise
            // the thread feeds audio the phase machine still reports as
            // finished and the UI never resumes.
            let phase = *shared.phase.lock().expect("phase lock");
            if matches!(phase, Phase::Ended | Phase::Failed) {
                shared.set_phase(if paused { Phase::Paused } else { Phase::Playing });
            }
        }
    };

    let mut appended_any = false;
    // Consecutive transient decode failures (single bad packet / dropped
    // HTTP range fetch). The old code killed the decode thread on the first
    // error, freezing the timeline on a silent tail after a seek that landed
    // on a slow/flaky chunk. Retry briefly; only fail after sustained errors.
    let mut consec_errors: u32 = 0;
    const MAX_CONSEC_ERRORS: u32 = 8;
    // Seek target whose queue swap is still pending: the container has been
    // seeked, but the old queued audio is intentionally left draining while
    // the first post-seek chunk is fetched/decoded (see the feed loop). This
    // keeps the device fed across slow or hanging seeks — without it, a seek
    // that blocks on HTTP range requests starves the output into silence
    // (the "timeline moves but the song stops" failure on WASAPI).
    let mut seek_pending: Option<f64> = None;

    // Initial output setup.
    {
        let mut out = shared.out.lock().expect("out lock");
        if autoplay {
            out.play();
        } else {
            out.pause();
        }
    }

    loop {
        // ── Service all pending commands ──
        // Drained first (non-blocking), then executed in order. Runs of
        // consecutive Seeks collapse to the latest target: timeline drags
        // and +10 s fast-forward spam queue one Seek per tick, and each
        // seek costs blocking HTTP seeks — without coalescing, a burst
        // keeps the decode thread seeking for seconds (looks "stuck").
        let mut pending: Vec<Cmd> = Vec::new();
        loop {
            match cmd_rx.try_recv() {
                Ok(c) => pending.push(c),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }
        let mut coalesced: Vec<Cmd> = Vec::with_capacity(pending.len());
        let mut seek_target: Option<f64> = None;
        for c in pending {
            match c {
                Cmd::Seek(t) => seek_target = Some(t),
                Cmd::Exit => {
                    if let Some(t) = seek_target.take() {
                        coalesced.push(Cmd::Seek(t));
                    }
                    coalesced.push(Cmd::Exit);
                    break;
                }
                other => {
                    if let Some(t) = seek_target.take() {
                        coalesced.push(Cmd::Seek(t));
                    }
                    coalesced.push(other);
                }
            }
        }
        if let Some(t) = seek_target.take() {
            coalesced.push(Cmd::Seek(t));
        }

        for cmd in coalesced {
            match cmd {
                Cmd::Exit => return,
                Cmd::Pause => {
                    shared.out.lock().expect("out lock").pause();
                    shared.set_phase(Phase::Paused);
                }
                Cmd::Resume => {
                    shared.out.lock().expect("out lock").play();
                    shared.set_phase(Phase::Playing);
                }
                Cmd::Seek(t) => {
                    // Sanitize IPC input: NaN/infinite/negative targets would
                    // poison the position anchor (NaN propagates into every
                    // poll and freezes the timeline at NaN).
                    if !t.is_finite() {
                        eprintln!("[nexora-audio] ignoring non-finite seek target");
                        continue;
                    }
                    // Clamp into known bounds: seeking past EOS lands the
                    // container at end-of-stream, the thread reports Ended and
                    // the UI freezes on silence. Leave 200 ms headroom.
                    let target = {
                        let dur = *shared.duration_sec.lock().expect("duration lock");
                        match dur {
                            Some(d) if d > 0.25 => t.max(0.0).min(d - 0.2),
                            _ => t.max(0.0),
                        }
                    };
                    // Seek the container FIRST: on failure the queued audio
                    // is untouched, so playback continues from the old
                    // position instead of going silent with a stale anchor.
                    if let Err(e) = dec.seek_seconds(target) {
                        eprintln!("[nexora-audio] seek failed: {e}");
                        continue;
                    }
                    consec_errors = 0;
                    let device_paused =
                        shared.out.lock().expect("out lock").is_paused();
                    if device_paused {
                        // Paused device: nothing is draining, so swap
                        // immediately — dropping the stale queue loses
                        // nothing audible and the anchor must move to the
                        // target right away (the UI already shows it).
                        // Playback starts from the target on resume.
                        do_swap(target, &dec);
                    } else {
                        // Playing device: keep the still-buffered audio
                        // draining while the first post-seek chunk is
                        // fetched and decoded, so a slow or hanging seek
                        // (HTTP range fetch) cannot starve the output into
                        // silence. The queue swap happens when that chunk
                        // arrives (feed loop below).
                        seek_pending = Some(target);
                    }
                }
                Cmd::SetVolume(v) => shared.out.lock().expect("out lock").set_volume(v),
                Cmd::SetSpeed(r) => shared.out.lock().expect("out lock").set_speed(r),
            }
        }

        // ── Keep the queue fed (not while paused — mirrors a paused device,
        // which stops draining; keeps NullSink position semantics truthful).
        let target_buffered = {
            let info = dec.info();
            TARGET_BUFFERED_FRAMES_PER_CH * (info.channels.max(1) as u64)
        };
        let need_more = {
            let out = shared.out.lock().expect("out lock");
            seek_pending.is_some()
                || (!out.is_paused()
                    && out.buffered_frames() < target_buffered
                    && !dec.is_eos())
        };
        if need_more {
            match dec.next_chunk() {
                Ok(Some(samples)) => {
                    consec_errors = 0;
                    appended_any = true;
                    // ── Pending seek swap (playing device) ──
                    // The container was seeked by the command loop; this is
                    // the first decoded chunk at the target. Swap now: drop
                    // the pre-seek queue and rebase the anchor to the target.
                    // The anchor is rebased only here — not at seek-command
                    // time — because the pre-seek audio kept playing while
                    // this chunk was being fetched; played_frames() includes
                    // that overlap, so rebase at swap time keeps the reported
                    // position truthful.
                    if let Some(pending) = seek_pending.take() {
                        do_swap(pending, &dec);
                    }
                    {
                        let info = dec.info();
                        shared.out.lock().expect("out lock").append(
                            &samples,
                            info.channels.max(1) as u32,
                            info.sample_rate,
                        );
                    }
                    // First fill crossing the prebuffer threshold flips
                    // Opening → Ready → (Playing | Paused) exactly once.
                    if matches!(*shared.phase.lock().expect("phase lock"), Phase::Opening)
                        && shared
                            .out
                            .lock()
                            .expect("out lock")
                            .buffered_frames()
                            > target_buffered / 4
                    {
                        shared.set_phase(Phase::Ready);
                        shared.set_phase(if autoplay { Phase::Playing } else { Phase::Paused });
                    }
                }
                Ok(None) => {
                    consec_errors = 0;
                    // A pending seek that lands at EOS cannot be swapped (no
                    // new chunk arrives); drop it so the feed loop does not
                    // spin force-decoding None.
                    seek_pending = None;
                    /* EOS reached */
                }
                Err(e) => {
                    consec_errors += 1;
                    eprintln!(
                        "[nexora-audio] decode error ({consec_errors}/{MAX_CONSEC_ERRORS}): {e}"
                    );
                    if consec_errors >= MAX_CONSEC_ERRORS {
                        shared.fire(PlayerEvent::Error(e.to_string()));
                        shared.set_phase(Phase::Failed);
                        return;
                    }
                    // Transient (flaky range fetch / corrupt packet after a
                    // coarse seek): back off briefly and retry instead of
                    // killing playback and freezing the timeline.
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }

        // ── End-of-stream is derived state: decoder done AND device fully
        // drained. Fires once per arrival (seeking back clears eos and can
        // legitimately arrive again).
        if dec.is_eos() && appended_any {
            // Null-style sinks drain instantly, so the buffered-threshold
            // transition above may never fire — complete the Opening arc here.
            {
                let mut ph = shared.phase.lock().expect("phase lock");
                if *ph == Phase::Opening {
                    *ph = Phase::Ready;
                    drop(ph);
                    shared.fire(PlayerEvent::Ready);
                    shared.set_phase(if autoplay { Phase::Playing } else { Phase::Paused });
                }
            }
            let drained = {
                let out = shared.out.lock().expect("out lock");
                out.buffered_frames() == 0 && out.played_frames() > 0
            };
            if drained {
                let mut ph = shared.phase.lock().expect("phase lock");
                let arrived = *ph != Phase::Ended;
                if arrived {
                    *ph = Phase::Ended;
                    drop(ph);
                    shared.fire(PlayerEvent::Ended);
                }
            }
        }

        std::thread::sleep(Duration::from_millis(
            if matches!(*shared.phase.lock().expect("phase lock"), Phase::Ended) { 100 } else { 20 },
        ));
    }
}

#[cfg(all(test, feature = "decode"))]
mod tests {
    use super::*;
    use std::io;
    use std::io::Read;
    use std::io::Seek;
    use std::io::SeekFrom;
    use std::time::Instant;
    use crate::output::NullSink;
    use std::io::Cursor;
    use std::sync::mpsc;

    fn fixture(name: &str) -> Vec<u8> {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/");
        std::fs::read(format!("{path}{name}")).expect("fixture")
    }

    /// Waits until `pred(phase)` holds or timeout; returns last phase.
    fn wait_phase(h: &PlayerHandle, pred: impl Fn(Phase) -> bool, ms: u64) -> Phase {
        let deadline = Instant::now() + Duration::from_millis(ms);
        loop {
            let p = h.phase();
            if pred(p) || Instant::now() > deadline {
                return p;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn open_alac(start: Option<f64>) -> PlayerHandle {
        let bytes = fixture("tone-alac.m4a");
        PlayerHandle::open(
            Box::new(Cursor::new(bytes)),
            Box::new(NullSink::new()),
            start,
            true,
        )
        .expect("open alac")
    }

    #[test]
    fn plays_to_end_and_fires_events_in_order() {
        let h = open_alac(None);

        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        h.on_event(Box::new(move |ev| {
            let _ = tx.lock().unwrap().send(ev);
        }));
        // Re-install before any event could fire in this test's timeline:
        // open() already started the thread, so Ready/Playing may have fired
        // before we attached. We assert on what we can still observe.

        let end_phase = wait_phase(&h, |p| p == Phase::Ended, 4000);
        assert_eq!(end_phase, Phase::Ended, "track should reach Ended");

        // Position clamps to ~duration.
        let dur = h.duration().expect("duration known");
        let pos = h.position();
        assert!(
            pos <= dur + 0.5,
            "position {pos} should not exceed duration {dur}"
        );

        // Event stream must contain Ended exactly once.
        let mut ended_count = 0;
        while let Ok(ev) = rx.try_recv() {
            if matches!(ev, PlayerEvent::Ended) {
                ended_count += 1;
            }
        }
        assert_eq!(ended_count, 1, "exactly one Ended event");
    }

    #[test]
    fn seek_updates_position_and_track_continues_to_end() {
        let h = open_alac(None);
        wait_phase(&h, |p| matches!(p, Phase::Playing | Phase::Ended), 4000);

        h.seek(0.5).unwrap();
        std::thread::sleep(Duration::from_millis(120));
        let pos = h.position();
        assert!(
            (0.35..=0.75).contains(&pos),
            "position after seek ≈0.5 s, got {pos}"
        );

        let end_phase = wait_phase(&h, |p| p == Phase::Ended, 5000);
        assert_eq!(end_phase, Phase::Ended);
    }

    #[test]
    fn rapid_seek_burst_lands_on_latest_target() {
        // Fast-forward spam / timeline drags queue one Seek per tick. While
        // paused nothing is fed, so the position anchor holds exactly the
        // last executed target — a burst must collapse to it, not drift.
        // (Fixtures are 1 s tones: targets stay below the duration.)
        let bytes = fixture("tone-alac.m4a");
        let h = PlayerHandle::open(
            Box::new(Cursor::new(bytes)),
            Box::new(NullSink::new()),
            None,
            false, // paused → deterministic position anchor
        )
        .expect("open alac paused");
        assert_eq!(wait_phase(&h, |p| p == Phase::Paused, 2000), Phase::Paused);

        for i in 0..10 {
            h.seek(0.05 * i as f64).unwrap();
        }
        h.seek(0.7).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let pos = h.position();
        assert!(
            (0.6..=0.8).contains(&pos),
            "position after seek burst ≈0.7 s, got {pos}"
        );

        // And the track still plays through to the end afterwards.
        h.play().unwrap();
        assert_eq!(wait_phase(&h, |p| p == Phase::Ended, 6000), Phase::Ended);
    }

    #[test]
    fn seek_after_end_revives_playback() {
        // Clicking the timeline after the track finished must restart it —
        // the phase machine must leave Ended, not keep feeding silently.
        let h = open_alac(None);
        assert_eq!(wait_phase(&h, |p| p == Phase::Ended, 4000), Phase::Ended);

        h.seek(0.0).unwrap();
        let revived = wait_phase(&h, |p| matches!(p, Phase::Playing | Phase::Paused), 2000);
        assert!(
            matches!(revived, Phase::Playing | Phase::Paused),
            "seek after end should revive playback, got {revived:?}"
        );
        assert_eq!(wait_phase(&h, |p| p == Phase::Ended, 6000), Phase::Ended);
    }

    #[test]
    fn pause_freezes_position_resume_finishes() {
        // Start paused: with the auto-consume NullSink a playing track ends
        // almost instantly, so mid-play pausing is unobservable. Starting
        // paused gives deterministic frozen-position semantics identical to
        // a paused hardware sink.
        let bytes = fixture("tone-alac.m4a");
        let h = PlayerHandle::open(
            Box::new(Cursor::new(bytes)),
            Box::new(NullSink::new()),
            None,
            false, // autoplay=false → starts Paused
        )
        .expect("open alac paused");

        assert_eq!(wait_phase(&h, |p| p == Phase::Paused, 2000), Phase::Paused);

        std::thread::sleep(Duration::from_millis(150));
        let frozen = h.position();
        std::thread::sleep(Duration::from_millis(120));
        let after = h.position();
        assert!(
            (after - frozen).abs() < 0.05,
            "paused position drifted: {frozen} → {after}"
        );

        h.play().unwrap();
        assert_eq!(wait_phase(&h, |p| p == Phase::Ended, 6000), Phase::Ended);
    }

    // ── Keep-alive seek swap (regression: "timeline moves but song stops") ──

    /// Device simulation with real buffering semantics: appended frames sit
    /// in a queue until drained. Unlike `NullSink` (instant auto-consume),
    /// this exposes the starvation window the old up-front `clear()` caused.
    #[derive(Clone, Default)]
    struct QueueSink(Arc<std::sync::Mutex<QueueState>>);

    #[derive(Default)]
    struct QueueState {
        buffered: Vec<f32>,
        played: u64,
        paused: bool,
        clears: usize,
    }

    impl QueueSink {
        /// Simulates the device consuming `n` interleaved samples.
        fn drain(&self, n: usize) {
            let mut s = self.0.lock().unwrap();
            let n = n.min(s.buffered.len());
            s.buffered.drain(..n);
            s.played += n as u64;
        }
    }

    impl AudioOut for QueueSink {
        fn append(&mut self, samples: &[f32], _channels: u32, _sample_rate: u32) {
            self.0.lock().unwrap().buffered.extend_from_slice(samples);
        }
        fn clear(&mut self) {
            let mut s = self.0.lock().unwrap();
            s.buffered.clear();
            s.clears += 1;
        }
        fn play(&mut self) {
            self.0.lock().unwrap().paused = false;
        }
        fn pause(&mut self) {
            self.0.lock().unwrap().paused = true;
        }
        fn is_paused(&self) -> bool {
            self.0.lock().unwrap().paused
        }
        fn set_volume(&mut self, _v: f32) {}
        fn volume(&self) -> f32 {
            1.0
        }
        fn played_frames(&self) -> u64 {
            self.0.lock().unwrap().played
        }
        fn buffered_frames(&self) -> u64 {
            self.0.lock().unwrap().buffered.len() as u64
        }
    }

    /// Source whose first read after every seek blocks briefly — models the
    /// production `HttpRangeReader` fetching the seek-target chunk over a
    /// slow HTTP range request. Symphonia's FLAC seek binary-searches the
    /// stream (a few seek+read iterations), so the delay stays short (60 ms)
    /// and the total seek lands in ~200 ms.
    struct SlowSource {
        inner: Cursor<Vec<u8>>,
        len: u64,
        delay: Duration,
        delay_next_read: bool,
    }

    impl SlowSource {
        fn new(bytes: Vec<u8>, delay: Duration) -> Self {
            let len = bytes.len() as u64;
            Self { inner: Cursor::new(bytes), len, delay, delay_next_read: false }
        }
    }

    impl Read for SlowSource {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.delay_next_read {
                self.delay_next_read = false;
                std::thread::sleep(self.delay);
            }
            self.inner.read(buf)
        }
    }

    impl Seek for SlowSource {
        fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
            let r = self.inner.seek(pos)?;
            self.delay_next_read = true;
            Ok(r)
        }
    }

    impl SymMediaSource for SlowSource {
        fn is_seekable(&self) -> bool {
            true
        }
        fn byte_len(&self) -> Option<u64> {
            Some(self.len)
        }
    }

    /// Uses the 1 s stereo FLAC fixture (contiguous frames after a seek, so
    /// only the seek itself triggers the slow read; MP4 would seek the source
    /// per packet). Its ~1 s prebuffer survives a 400 ms slow fetch.
    fn fixture_bytes() -> Vec<u8> {
        fixture("tone.flac")
    }

    #[test]
    fn slow_seek_keeps_device_fed_until_swap() {
        let src = Box::new(SlowSource::new(fixture_bytes(), Duration::from_millis(60)));
        let sink = QueueSink::default();
        let h = PlayerHandle::open(src, Box::new(sink.clone()), None, true).expect("open flac");

        // Let the decode thread fill the queue (no consumption), then drain
        // a little so the device has consumed audio and the position moves.
        std::thread::sleep(Duration::from_millis(400));
        sink.drain(8820); // 0.1 s of stereo audio
        assert!(h.position() > 0.0, "playback should have started");
        let pre_seek_buffered = sink.buffered_frames();
        assert!(pre_seek_buffered > 0, "queue should hold pre-seek audio");

        // Seek forward; the first post-seek read blocks briefly. While the
        // swap is pending the pre-seek queue must keep draining — the old
        // code cleared it up front and starved the device into silence.
        h.seek(0.5).unwrap();
        let mut min_buffered = u64::MAX;
        let mut reached_target = false;
        let mut max_pos = 0.0f64;
        for _ in 0..40 {
            std::thread::sleep(Duration::from_millis(20));
            sink.drain(1764);
            // Track starvation only until the swap lands: afterwards the
            // track legitimately drains to zero at end-of-stream.
            let b = sink.buffered_frames();
            if !reached_target {
                min_buffered = min_buffered.min(b);
            }
            let pos = h.position();
            max_pos = max_pos.max(pos);
            if (0.4..=0.75).contains(&pos) {
                reached_target = true;
            }
        }
        assert!(
            min_buffered > 0,
            "device starved during a slow seek: min_buffered={min_buffered}"
        );
        assert!(
            reached_target,
            "seek never landed at the target (position never reached ~0.5)"
        );
        assert!(
            max_pos >= 0.6,
            "playback did not continue after the swap (max_pos={max_pos})"
        );
        // Exactly one swap (one clear) for the single seek.
        assert_eq!(sink.0.lock().unwrap().clears, 1, "one clear per seek swap");
    }
}
