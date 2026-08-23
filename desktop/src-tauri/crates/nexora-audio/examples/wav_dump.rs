//! M2 harness: stream-decode a URL (Nexora `rawUrl`, local file path, or any
//! range-capable http(s) endpoint) and write interleaved f32 PCM as a WAV.
//!
//! Usage:
//!   cargo run --features decode --example wav_dump -- <url-or-file> [out.wav] [token]
//!
//! On this headless dev box the WAV output doubles as the "did it actually
//! play" verification; the real desktop app feeds the same samples into
//! rodio/WASAPI instead.

use nexora_audio::{decode_all, HttpRangeConfig, HttpRangeReader};
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let src = args.next().expect("usage: wav_dump <url|file> [out.wav] [bearer]");
    let out_path = args.next().unwrap_or_else(|| "decoded.wav".into());
    let bearer = args.next();

    let started = Instant::now();
    // Local file → decode directly; remote → HttpRangeReader streaming.
    let audio = if std::path::Path::new(&src).exists() {
        let f = std::fs::File::open(&src)?;
        decode_all(Box::new(f))?
    } else {
        let cfg = HttpRangeConfig {
            bearer_token: bearer,
            ..Default::default()
        };
        let reader = HttpRangeReader::open_with(src, cfg)?;
        reader.prefetch_tail(256 * 1024)?; // moov-at-end fast path
        decode_all(Box::new(reader))?
    };
    let decode_secs = started.elapsed().as_secs_f64();

    let spec = hound::WavSpec {
        channels: audio.info.channels as u16,
        sample_rate: audio.info.sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut wav = hound::WavWriter::create(&out_path, spec)?;
    for s in &audio.samples_f32 {
        wav.write_sample(*s)?;
    }
    wav.finalize()?;

    let frames = audio.samples_f32.len() / audio.info.channels.max(1);
    println!(
        "codec={} rate={} ch={} bits={} frames={frames} dur≈{:.2}s decode+write={:.3}s → {out_path}",
        audio.info.codec,
        audio.info.sample_rate,
        audio.info.channels,
        audio.info.bits_per_sample,
        audio.info.duration_sec.unwrap_or(0.0),
        decode_secs,
    );
    Ok(())
}
