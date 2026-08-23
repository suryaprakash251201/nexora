//! Symphonia-based decode pipeline.
//!
//! Decodes anything symphonia can demux/decode (MP4/AAC, MP4/ALAC, FLAC,
//! MP3, raw PCM…) from any [`MediaSource`] — in practice either a
//! `Box<io::Cursor<_>>` (tests) or a boxed [`HttpRangeReader`] from this
//! crate (production streaming over HTTP Range).
//!
//! All sample formats are normalized to interleaved f32.

use std::io::{Read, Seek};

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

    let mut hint = Hint::new();
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
                        existing_spec != &spec || existing_buf.capacity() < decoded.frames() as usize
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
