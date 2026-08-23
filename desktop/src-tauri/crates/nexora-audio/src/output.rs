//! Audio output backends.
//!
//! [`AudioOut`] abstracts the platform mixer so the player state machine is
//! testable without hardware. Two implementations:
//! - [`NullSink`] — always available; consumes instantly (tests/headless CI).
//! - `RodioSink` (feature `output`) — rodio → cpal → WASAPI/ALSA/Pulse.

/// Frame-consuming output device abstraction.
///
/// All frame counters are in *frames* (one sample per channel).
pub trait AudioOut: Send {
    /// Queue interleaved f32 samples for playback. Channels/rate describe
    /// this chunk's layout (constant per track, but only known after decode).
    fn append(&mut self, samples: &[f32], channels: u32, sample_rate: u32);
    /// Drop any queued-but-unplayed audio (seek).
    fn clear(&mut self);
    fn play(&mut self);
    fn pause(&mut self);
    fn is_paused(&self) -> bool;
    fn set_volume(&mut self, volume: f32);
    fn volume(&self) -> f32;
    /// Playback rate multiplier (1.0 = normal). Unsupported impls may ignore.
    fn set_speed(&mut self, _rate: f64) {}
    /// Frames already rendered to the device.
    fn played_frames(&self) -> u64;
    /// Frames queued but not yet rendered.
    fn buffered_frames(&self) -> u64;
}

/// Always-available no-hardware sink: appended frames are counted as played
/// immediately. Used by unit tests and headless CI runs.
#[derive(Debug, Default)]
pub struct NullSink {
    played: u64,
    paused: bool,
    volume: f32,
    speed: f64,
}

impl NullSink {
    pub fn new() -> Self {
        Self {
            volume: 1.0,
            speed: 1.0,
            ..Default::default()
        }
    }
}

impl AudioOut for NullSink {
    fn append(&mut self, samples: &[f32], _channels: u32, _sample_rate: u32) {
        // Auto-consume: tests observe deterministic "played" progression.
        self.played += samples.len() as u64;
    }
    fn clear(&mut self) {}
    fn play(&mut self) {
        self.paused = false;
    }
    fn pause(&mut self) {
        self.paused = true;
    }
    fn is_paused(&self) -> bool {
        self.paused
    }
    fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
    }
    fn volume(&self) -> f32 {
        self.volume
    }
    fn set_speed(&mut self, rate: f64) {
        self.speed = rate;
    }
    fn played_frames(&self) -> u64 {
        self.played
    }
    fn buffered_frames(&self) -> u64 {
        0
    }
}

// ── rodio backend (feature-gated; Windows uses WASAPI via cpal) ─────────────

#[cfg(feature = "output")]
pub mod rodio_out {
    use super::AudioOut;
    use rodio::{OutputStream, OutputStreamHandle, SampleFormat, SamplesBuffer, Sink, Source};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    /// Wraps a samples chunk and counts every frame handed to the device.
    struct Counting {
        inner: SamplesBuffer<f32>,
        counter: Arc<AtomicU64>,
    }

    impl Iterator for Counting {
        type Item = f32;
        fn next(&mut self) -> Option<f32> {
            self.inner
                .next()
                .inspect(|_| self.counter.fetch_add(1, Ordering::Relaxed))
        }
    }

    impl Source for Counting {
        fn current_frame_len(&self) -> Option<usize> {
            self.inner.current_frame_len()
        }
    }

    /// rodio-backed output. One instance per track; owns the device stream so
    /// dropping it releases the device cleanly. Channel/rate are supplied per
    /// append (known only after decode).
    pub struct RodioSink {
        _stream: OutputStream, // must outlive the handle
        handle: OutputStreamHandle,
        sink: Sink,
        counter: Arc<AtomicU64>,
        appended_total: u64,
        volume: f32,
    }

    impl RodioSink {
        pub fn try_new() -> Result<Self, String> {
            let (stream, handle) =
                OutputStream::try_default().map_err(|e| format!("no audio device: {e}"))?;
            let sink = Sink::try_new(&handle).map_err(|e| format!("sink init: {e}"))?;
            sink.set_volume(1.0);
            Ok(Self {
                _stream: stream,
                handle,
                sink,
                counter: Arc::new(AtomicU64::new(0)),
                appended_total: 0,
                volume: 1.0,
            })
        }
    }

    impl AudioOut for RodioSink {
        fn append(&mut self, samples: &[f32], channels: u32, sample_rate: u32) {
            let chunk = SamplesBuffer::new(
                SampleFormat::F32,
                channels as u16,
                sample_rate,
                samples.to_vec(),
            );
            self.sink.append(Counting {
                inner: chunk,
                counter: Arc::clone(&self.counter),
            });
            self.appended_total += samples.len() as u64;
        }
        fn clear(&mut self) {
            self.sink.clear();
        }
        fn play(&mut self) {
            self.sink.play();
        }
        fn pause(&mut self) {
            self.sink.pause();
        }
        fn is_paused(&self) -> bool {
            self.sink.is_paused()
        }
        fn set_volume(&mut self, volume: f32) {
            self.volume = volume.clamp(0.0, 1.0);
            self.sink.set_volume(self.volume);
        }
        fn volume(&self) -> f32 {
            self.volume
        }
        fn set_speed(&mut self, rate: f64) {
            let r = rate.clamp(0.0625, 16.0);
            self.sink.set_speed(r as f32);
        }
        fn played_frames(&self) -> u64 {
            self.counter.load(Ordering::Relaxed)
        }
        fn buffered_frames(&self) -> u64 {
            self.appended_total
                .saturating_sub(self.counter.load(Ordering::Relaxed))
        }
    }
}
