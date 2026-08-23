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
    const TARGET_BUFFERED_FRAMES: u64 = 44_100; // ≈1 s @44.1 kHz

    let mut appended_any = false;

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
        loop {
            match cmd_rx.try_recv() {
                Ok(Cmd::Exit) => return,
                Ok(Cmd::Pause) => {
                    shared.out.lock().expect("out lock").pause();
                    shared.set_phase(Phase::Paused);
                }
                Ok(Cmd::Resume) => {
                    shared.out.lock().expect("out lock").play();
                    shared.set_phase(Phase::Playing);
                }
                Ok(Cmd::Seek(t)) => {
                    {
                        let mut out = shared.out.lock().expect("out lock");
                        out.clear();
                    }
                    if let Err(e) = dec.seek_seconds(t) {
                        eprintln!("[nexora-audio] seek failed: {e}");
                        continue;
                    }
                    // Reset position anchor to the seek target: played_frames
                    // keeps its global count, so rebase it via a fresh epoch —
                    // simplest correct approach: store played-at-seek.
                    {
                        let out = shared.out.lock().expect("out lock");
                        *shared.base_sec.lock().expect("base lock") =
                            t - out.played_frames() as f64 / f64::from(dec.info().sample_rate.max(1));
                    }
                }
                Ok(Cmd::SetVolume(v)) => shared.out.lock().expect("out lock").set_volume(v),
                Ok(Cmd::SetSpeed(r)) => shared.out.lock().expect("out lock").set_speed(r),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }

        // ── Keep the queue fed (not while paused — mirrors a paused device,
        // which stops draining; keeps NullSink position semantics truthful).
        let need_more = {
            let out = shared.out.lock().expect("out lock");
            !out.is_paused()
                && out.buffered_frames() < TARGET_BUFFERED_FRAMES
                && !dec.is_eos()
        };
        if need_more {
            match dec.next_chunk() {
                Ok(Some(samples)) => {
                    appended_any = true;
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
                            > TARGET_BUFFERED_FRAMES / 4
                    {
                        shared.set_phase(Phase::Ready);
                        shared.set_phase(if autoplay { Phase::Playing } else { Phase::Paused });
                    }
                }
                Ok(None) => { /* EOS reached */ }
                Err(e) => {
                    eprintln!("[nexora-audio] decode error: {e}");
                    shared.fire(PlayerEvent::Error(e.to_string()));
                    shared.set_phase(Phase::Failed);
                    return;
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
}
