//! M2 acceptance tests: symphonia decode over Cursor and — critically — over
//! `HttpRangeReader` streaming from the mock range server, including the
//! moov-at-end MP4 layout.

#![cfg(feature = "decode")]

mod common;

use std::io::Cursor;

use nexora_audio::{decode_all, HttpRangeConfig, HttpRangeReader};

use common::spawn_mock;

fn fixture(name: &str) -> Vec<u8> {
    let path = std::env::var("CARGO_MANIFEST_DIR")
        .map(|d| format!("{d}/tests/fixtures/{name}"))
        .unwrap_or_else(|_| format!("tests/fixtures/{name}"));
    std::fs::read(&path).unwrap_or_else(|e| panic!("read {path}: {e}"))
}

fn cfg() -> HttpRangeConfig {
    HttpRangeConfig {
        chunk_size: 4096, // deliberately small → many range requests
        max_chunks: 64,
        connect_timeout: std::time::Duration::from_secs(5),
        timeout: std::time::Duration::from_secs(10),
        bearer_token: None,
    }
}

/// Shared assertions for a 1-second stereo 44.1 kHz tone.
fn assert_tone(audio: &nexora_audio::DecodedAudio, codec_prefix: &str) {
    assert!(
        audio.info.codec.starts_with(codec_prefix),
        "codec={} want prefix {codec_prefix}",
        audio.info.codec
    );
    assert_eq!(audio.info.sample_rate, 44100, "sample_rate");
    assert_eq!(audio.info.channels, 2, "channels");

    let frames = audio.samples_f32.len() / audio.info.channels;
    // Codecs pad (AAC priming) or trim slightly; ±15 % is generous but tight
    // enough to catch truncation bugs.
    assert!(
        (42_000..=51_000).contains(&(frames as i64)),
        "frames={frames} should be ≈1 s of audio"
    );

    // A 440 Hz sine must not decode to silence.
    let peak = audio
        .samples_f32
        .iter()
        .fold(0.0f32, |m, s| m.max(s.abs()));
    assert!(peak > 0.05, "decoded audio is near-silent (peak={peak})");

    if let Some(dur) = audio.info.duration_sec {
        assert!((0.9..=1.3).contains(&dur), "duration_sec={dur}");
    }
}

#[test]
fn decodes_aac_m4a_from_memory_and_http_range() {
    let bytes = fixture("tone-aac.m4a");

    let mem = decode_all(Box::new(Cursor::new(bytes.clone()))).expect("cursor aac");
    assert_tone(&mem, "aac");

    let (url, _state, _stop) = spawn_mock(bytes, false);
    let reader = HttpRangeReader::open_with(url, cfg()).expect("open");
    let streamed = decode_all(Box::new(reader)).expect("http-range aac");
    assert_tone(&streamed, "aac");
}

#[test]
fn decodes_alac_m4a_faststart_from_memory_and_http_range() {
    let bytes = fixture("tone-alac.m4a"); // moov at front

    let mem = decode_all(Box::new(Cursor::new(bytes.clone()))).expect("cursor alac");
    assert_tone(&mem, "alac");

    let (url, _state, _stop) = spawn_mock(bytes, false);
    let reader = HttpRangeReader::open_with(url, cfg()).expect("open");
    let streamed = decode_all(Box::new(reader)).expect("http-range alac");
    assert_tone(&streamed, "alac");
}

/// The hard case: moov atom at END of file. The reader must service seeks to
/// the tail before any samples can be produced.
#[test]
fn decodes_alac_m4a_with_moov_at_end_over_http_range() {
    let bytes = fixture("tone-alac-moovend.m4a");
    let bytes_len = bytes.len();
    let (url, state, _stop) = spawn_mock(bytes, false);

    let reader = HttpRangeReader::open_with(url, cfg()).expect("open");
    let streamed = decode_all(Box::new(reader)).expect("http-range moovend alac");
    assert_tone(&streamed, "alac");

    // Sanity: a request covered the tail of the file (moov lives there).
    let file_len = bytes_len as u64;
    let served = state.served_ranges();
    let covered_tail = served.iter().any(|r| {
        r.split('-')
            .next_back()
            .and_then(|e| e.parse::<u64>().ok())
            .map(|e| e >= file_len - 1024)
            .unwrap_or(false)
    });
    assert!(
        covered_tail,
        "expected a request covering near-EOF; served={served:?}"
    );
}

#[test]
fn decodes_flac_and_mp3_from_memory() {
    let flac = decode_all(Box::new(Cursor::new(fixture("tone.flac")))).expect("flac");
    assert_tone(&flac, "flac");

    let mp3 = decode_all(Box::new(Cursor::new(fixture("tone.mp3")))).expect("mp3");
    assert_tone(&mp3, "mp3");
}

#[test]
fn alac_decodes_to_integer_pcm_samples() {
    let audio = decode_all(Box::new(Cursor::new(fixture("tone-alac.m4a")))).expect("alac");
    // symphonia's ALAC decoder outputs S32 internally even for 16-bit
    // sources, so the surfaced depth reflects the decode buffer (≥16),
    // not necessarily the encoded depth.
    assert!(
        matches!(audio.info.bits_per_sample, 16 | 24 | 32),
        "unexpected bit depth {}",
        audio.info.bits_per_sample
    );
}
