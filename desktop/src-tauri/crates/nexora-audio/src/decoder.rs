//! Symphonia-based decode pipeline.
//!
//! Decodes anything symphonia can demux/decode (MP4/AAC, MP4/ALAC, FLAC,
//! MP3, raw PCM…) from any [`MediaSource`] — in practice either a
//! `Box<io::Cursor<_>>` (tests) or a boxed [`HttpRangeReader`] from this
//! crate (production streaming over HTTP Range).
//!
//! All sample formats are normalized to interleaved f32.


use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default;

/// Metadata describing the decoded track.
#[derive(Debug, Clone)]
pub struct TrackInfo {
    /// Short codec name, e.g. "aac", "alac", "flac", "mp3".
    pub codec: String,
    pub sample_rate: u32,
    pub channels: usize,
    /// Original bit depth when known (ALAC 16/24, PCM…); 0 when not exposed.
    pub bits_per_sample: u32,
    /// Duration in seconds when derivable (frames / sample-rate).
    pub duration_sec: Option<f64>,
}

/// Fully decoded audio: interleaved f32 samples plus track metadata.
#[derive(Debug, Clone)]
pub struct DecodedAudio {
    pub info: TrackInfo,
    /// Interleaved samples (`frames * channels`).
    pub samples_f32: Vec<f32>,
}

#[derive(Debug, thiserror::Error)]
pub enum DecoderError {
    #[error("no audio track found")]
    NoAudioTrack,
    #[error("probe failed: {0}")]
    Probe(String),
    #[error("decode failed: {0}")]
    Decode(String),
    #[error("i/o: {0}")]
    Io(#[from] std::io::Error),
}

impl From<SymphoniaError> for DecoderError {
    fn from(e: SymphoniaError) -> Self {
        match e {
            // Several demuxers signal end-of-stream as an UnexpectedEof I/O
            // error on the final packet read.
            SymphoniaError::IoError(ref ioe)
                if ioe.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                DecoderError::Decode("eof".into())
            }
            other => DecoderError::Decode(other.to_string()),
        }
    }
}

/// Decodes the entire stream into interleaved f32 samples.
pub fn decode_all(source: Box<dyn MediaSource>) -> Result<DecodedAudio, DecoderError> {
    let mss = MediaSourceStream::new(source, MediaSourceStreamOptions::default());

    let hint = Hint::new();
    let probed = default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| DecoderError::Probe(e.to_string()))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or(DecoderError::NoAudioTrack)?;

    let track_id = track.id;
    let n_frames = track.codec_params.n_frames;
    // Human-readable short name via the codec registry ("aac", "alac", …).
    let codec_name = default::get_codecs()
        .get_codec(track.codec_params.codec)
        .map(|d| d.short_name.to_string())
        .unwrap_or_else(|| track.codec_params.codec.to_string());
    let mut decoder = default::get_codecs().make(&track.codec_params, &DecoderOptions::default())?;

    let mut info = TrackInfo {
        codec: codec_name,
        sample_rate: track.codec_params.sample_rate.unwrap_or(0),
        channels: track
            .codec_params
            .channels
            .map(|c| c.count())
            .unwrap_or(0),
        bits_per_sample: track.codec_params.bits_per_sample.unwrap_or(0),
        duration_sec: None,
    };

    let mut samples: Vec<f32> = Vec::new();
    // (spec, buffer) — the buffer must be recreated when the stream's spec
    // changes mid-stream (rare, but legal) or grows past its allocation.
    let mut sbuf_state: Option<(symphonia::core::audio::SignalSpec, SampleBuffer<f32>)> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break; // clean end-of-stream for several demuxers
            }
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(e.into()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                // Surface original bit depth from the first decoded buffer
                // when the container didn't declare it (ALAC-in-MP4 case).
                if info.bits_per_sample == 0 {
                    use symphonia::core::audio::AudioBufferRef as Abr;
                    info.bits_per_sample = match &decoded {
                        Abr::U8(_) => 8,
                        Abr::S16(_) => 16,
                        Abr::S24(_) => 24,
                        Abr::S32(_) => 32,
                        _ => 0, // floating-point formats carry no "bit depth"
                    };
                }
                if info.sample_rate == 0 {
                    info.sample_rate = spec.rate;
                    info.channels = spec.channels.count();
                }
                let needs_new = match &sbuf_state {
                    Some((existing_spec, existing_buf)) => {
                        existing_spec != &spec || existing_buf.capacity() < decoded.frames()
                            * spec.channels.count()
                    }
                    None => true,
                };
                if needs_new {
                    sbuf_state = Some((
                        spec,
                        SampleBuffer::<f32>::new(decoded.frames() as u64, spec),
                    ));
                }
                if let Some((_, sb)) = sbuf_state.as_mut() {
                    sb.copy_interleaved_ref(decoded);
                    samples.extend_from_slice(sb.samples());
                }
            }
            // Skip corrupt packets rather than aborting the track.
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(e.into()),
        }
    }

    if samples.is_empty() {
        return Err(DecoderError::Decode("zero samples decoded".into()));
    }
    if info.channels == 0 || info.sample_rate == 0 {
        if let Some((spec, _)) = sbuf_state.as_ref() {
            info.sample_rate = spec.rate;
            info.channels = spec.channels.count();
        }
    }
    match (n_frames, info.sample_rate) {
        (Some(frames), sr) if sr > 0 => {
            info.duration_sec = Some(frames as f64 / f64::from(sr));
        }
        _ => {
            let frames = samples.len() / info.channels.max(1);
            if info.sample_rate > 0 {
                info.duration_sec = Some(frames as f64 / f64::from(info.sample_rate));
            }
        }
    }

    Ok(DecodedAudio { info, samples_f32: samples })
}

// ── Incremental decoding (player path) ──────────────────────────────────────

use symphonia::core::audio::SignalSpec;
use symphonia::core::formats::{SeekMode, SeekTo};
use symphonia::core::units::Time;

/// A track opened for incremental playback: pull chunks with [`next_chunk`],
/// seek with [`seek_seconds`]. Owned by the player's decode thread.
pub struct TrackDecoder {
    format: Box<dyn symphonia::core::formats::FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    spec: SignalSpec,
    bits_per_sample: u32,
    info: TrackInfo,
    sbuf: Option<SampleBuffer<f32>>,
    /// Samples decoded during open() not yet handed out.
    pending: Vec<f32>,
    eos: bool,
}

impl TrackDecoder {
    /// Opens and probes the source; eagerly decodes the first packet so
    /// sample-rate/channels are known immediately (MP4/ALAC containers often
    /// omit them from codec params).
    pub fn open(source: Box<dyn MediaSource>) -> Result<Self, DecoderError> {
        let mss = MediaSourceStream::new(source, MediaSourceStreamOptions::default());
        let hint = Hint::new();
        let probed = default::get_probe()
            .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
            .map_err(|e| DecoderError::Probe(e.to_string()))?;
        let format = probed.format;

        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or(DecoderError::NoAudioTrack)?
            .clone();
        let track_id = track.id;
        let codec_name = default::get_codecs()
            .get_codec(track.codec_params.codec)
            .map(|d| d.short_name.to_string())
            .unwrap_or_else(|| track.codec_params.codec.to_string());

        let decoder =
            default::get_codecs().make(&track.codec_params, &DecoderOptions::default())?;

        let mut td = Self {
            format,
            decoder,
            track_id,
            spec: SignalSpec::new(
                0,
                symphonia::core::audio::Channels::empty(),
            ),
            bits_per_sample: track.codec_params.bits_per_sample.unwrap_or(0),
            info: TrackInfo {
                codec: codec_name,
                sample_rate: track.codec_params.sample_rate.unwrap_or(0),
                channels: track
                    .codec_params
                    .channels
                    .map(|c| c.count())
                    .unwrap_or(0),
                bits_per_sample: track.codec_params.bits_per_sample.unwrap_or(0),
                duration_sec: track
                    .codec_params
                    .n_frames
                    .zip(track.codec_params.sample_rate)
                    .map(|(frames, sr)| frames as f64 / f64::from(sr)),
            },
            sbuf: None,
            pending: Vec::new(),
            eos: false,
        };
        // Prime the spec by decoding one packet (buffers its samples into the
        // first next_chunk() call via pending buffer below).
        let mut pending: Vec<f32> = Vec::new();
        while let Ok(packet) = td.format.next_packet() {
            if packet.track_id() != track_id {
                continue;
            }
            match td.decoder.decode(&packet) {
                Ok(decoded) => {
                    td.spec = *decoded.spec();
                    if td.info.sample_rate == 0 {
                        td.info.sample_rate = td.spec.rate;
                        td.info.channels = td.spec.channels.count();
                    }
                    if td.bits_per_sample == 0 {
                        use symphonia::core::audio::AudioBufferRef as Abr;
                        td.bits_per_sample = match &decoded {
                            Abr::U8(_) => 8,
                            Abr::S16(_) => 16,
                            Abr::S24(_) => 24,
                            Abr::S32(_) => 32,
                            _ => 0,
                        };
                        td.info.bits_per_sample = td.bits_per_sample;
                    }
                    let sb = SampleBuffer::<f32>::new(decoded.frames() as u64, td.spec);
                    let mut sb = sb;
                    sb.copy_interleaved_ref(decoded);
                    pending.extend_from_slice(sb.samples());
                    td.sbuf = Some(sb);
                    break;
                }
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(e) => return Err(e.into()),
            }
        }
        td.pending = pending;
        Ok(td)
    }

    pub fn info(&self) -> &TrackInfo {
        &self.info
    }

    pub fn is_eos(&self) -> bool {
        self.eos
    }

    /// Returns the next chunk of interleaved f32 samples (≈ one packet),
    /// `None` at end-of-stream.
    pub fn next_chunk(&mut self) -> Result<Option<Vec<f32>>, DecoderError> {
        if !self.pending.is_empty() {
            return Ok(Some(std::mem::take(&mut self.pending)));
        }
        if self.eos {
            return Ok(None);
        }
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(SymphoniaError::IoError(ref e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    self.eos = true;
                    return Ok(None);
                }
                Err(SymphoniaError::ResetRequired) => {
                    self.eos = true;
                    return Ok(None);
                }
                Err(e) => return Err(e.into()),
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            return match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    let spec = *decoded.spec();
                    if self.spec != spec {
                        self.sbuf = None; // spec changed → reallocate
                        self.spec = spec;
                    }
                    if self.info.sample_rate == 0 {
                        self.info.sample_rate = spec.rate;
                        self.info.channels = spec.channels.count();
                    }
                    let need = decoded.frames() * spec.channels.count();
                    let insufficient = self.sbuf.as_ref().map(|s| s.capacity() < need).unwrap_or(true);
                    if insufficient {
                        self.sbuf = Some(SampleBuffer::<f32>::new(
                            decoded.frames() as u64,
                            spec,
                        ));
                    }
                    if let Some(sb) = self.sbuf.as_mut() {
                        sb.copy_interleaved_ref(decoded);
                        Ok(Some(sb.samples().to_vec()))
                    } else {
                        Ok(None)
                    }
                }
                Err(SymphoniaError::DecodeError(_)) => continue, // skip bad packet
                Err(e) => Err(e.into()),
            };
        }
    }

    /// Coarse time seek (container sample-table based). After seeking, the
    /// caller should treat subsequent chunks as starting exactly at `sec`.
    pub fn seek_seconds(&mut self, sec: f64) -> Result<(), DecoderError> {
        let to = SeekTo::Time {
            time: Time::from(sec.max(0.0)),
            track_id: Some(self.track_id),
        };
        self.format.seek(SeekMode::Coarse, to)?;
        self.eos = false;
        if let Some(sb) = self.sbuf.as_mut() {
            sb.clear();
        }
        self.pending.clear();
        Ok(())
    }
}
