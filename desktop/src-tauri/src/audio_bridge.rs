//! Tauri IPC bridge for the native audio engine.
//!
//! Compiled only with the `native-audio` feature. The frontend detects
//! availability by invoking `audio_native_available` — in builds without the
//! feature a stub of the same name is registered and returns `false`.

use std::sync::Mutex;

use nexora_audio::{HttpRangeConfig, HttpRangeReader, PlayerEvent, PlayerHandle};
use tauri::{AppHandle, Emitter, State};

/// One active native player at a time (matches the single-element model the
/// web player already uses). Opening a new track replaces the old one.
#[derive(Default)]
pub struct AudioSession(pub Mutex<Option<PlayerHandle>>);

fn bearer_cfg(url: String, bearer: Option<String>) -> Result<HttpRangeReader, String> {
    let cfg = HttpRangeConfig {
        bearer_token: bearer,
        ..Default::default()
    };
    let reader = HttpRangeReader::open_with(&url, cfg).map_err(|e| e.to_string())?;
    // moov-at-end fast path: warm the tail before handing to symphonia.
    reader
        .prefetch_tail(256 * 1024)
        .map_err(|e| format!("tail prefetch failed: {e}"))?;
    Ok(reader)
}

#[tauri::command]
pub fn audio_native_available() -> bool {
    true
}

#[tauri::command]
pub fn audio_native_codecs() -> Vec<String> {
    vec![
        "aac".into(),
        "alac".into(),
        "flac".into(),
        "mp3".into(),
        "pcm".into(),
    ]
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn audio_native_open(
    app: AppHandle,
    session: State<'_, AudioSession>,
    url: String,
    bearer: Option<String>,
    start_sec: Option<f64>,
) -> Result<serde_json::Value, String> {
    use nexora_audio::output::rodio_out::RodioSink;

    let source = bearer_cfg(url.clone(), bearer)?;

    let mut handle = PlayerHandle::open(Box::new(source), Box::new(RodioSink::try_new()?), start_sec, true)
        .map_err(|e| e.to_string())?;

    // Forward player events to the WebView on one channel.
    let app_for_cb = app.clone();
    handle.on_event(Box::new(move |ev| {
        let payload = match ev {
            PlayerEvent::Ready => serde_json::json!({"kind": "ready"}),
            PlayerEvent::Playing => serde_json::json!({"kind": "playing"}),
            PlayerEvent::Paused => serde_json::json!({"kind": "paused"}),
            PlayerEvent::Ended => serde_json::json!({"kind": "ended"}),
            PlayerEvent::Error(m) => serde_json::json!({"kind": "error", "message": m}),
        };
        let _ = app_for_cb.emit("audio://event", payload);
    }));

    let info = handle.track_info();
    *session.0.lock().expect("session lock") = Some(handle);

    Ok(match info {
        Some(i) => serde_json::json!({
            "codec": i.codec,
            "sample_rate": i.sample_rate,
            "channels": i.channels,
            "bits_per_sample": i.bits_per_sample,
            "duration_sec": i.duration_sec,
        }),
        None => serde_json::json!(null),
    })
}

macro_rules! with_player {
    ($session:expr, $body:expr) => {{
        let guard = $session.0.lock().expect("session lock");
        match guard.as_ref() {
            Some(p) => $body(p),
            None => return Err("no active native track".into()),
        }
    }};
}

#[tauri::command]
pub fn audio_native_play(session: State<'_, AudioSession>) -> Result<(), String> {
    with_player!(session, |p: &PlayerHandle| p.play())
}

#[tauri::command]
pub fn audio_native_pause(session: State<'_, AudioSession>) -> Result<(), String> {
    with_player!(session, |p: &PlayerHandle| p.pause())
}

#[tauri::command]
pub fn audio_native_stop(session: State<'_, AudioSession>) -> Result<(), String> {
    // Dropping the handle stops the decode thread and releases the device.
    *session.0.lock().expect("session lock") = None;
    Ok(())
}

#[tauri::command]
pub fn audio_native_seek(session: State<'_, AudioSession>, sec: f64) -> Result<(), String> {
    with_player!(session, |p: &PlayerHandle| p.seek(sec))
}

#[tauri::command]
pub fn audio_native_set_volume(session: State<'_, AudioSession>, volume: f32) -> Result<(), String> {
    with_player!(session, |p: &PlayerHandle| p.set_volume(volume))
}

#[tauri::command]
pub fn audio_native_position(session: State<'_, AudioSession>) -> Result<f64, String> {
    with_player!(session, |p: &PlayerHandle| Ok(p.position()))
}

#[tauri::command]
pub fn audio_native_duration(session: State<'_, AudioSession>) -> Result<Option<f64>, String> {
    with_player!(session, |p: &PlayerHandle| Ok(p.duration()))
}
