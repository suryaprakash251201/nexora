use tauri::{Emitter, Manager};

/// Returns platform info to the frontend so it can adapt its UI.
#[tauri::command]
fn get_platform() -> serde_json::Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
    })
}

/// Toggle system sleep inhibition for large transfers.
#[tauri::command]
async fn set_sleep_inhibition(inhibit: bool, _app: tauri::AppHandle) -> Result<(), String> {
    // On Linux we can use the `power` crate or inhibit via D-Bus.
    // On other platforms, we try to keep the app "busy" to prevent sleep.
    // For now, we emit a log and let the frontend handle it visually.
    // In production, integrate with `tauri-plugin-power-manager` or similar.
    if inhibit {
        println!("[nexora] Preventing system sleep (transfers active)");
    } else {
        println!("[nexora] Allowing system sleep");
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── Plugins ──────────────────────────────────────────────
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())

        // Native desktop enhancements
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the existing window when a second instance is launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))

        // ── Custom commands ──────────────────────────────────────
        .invoke_handler(tauri::generate_handler![get_platform, set_sleep_inhibition])

        // ── App event handling ───────────────────────────────────
        .on_window_event(|window, event| {
            // Save window state before closing
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Emit a custom event so the frontend can clean up
                // window.app_handle() returns &AppHandle in Tauri v2
                let app = window.app_handle();
                let _ = app.emit("nexora:app-closing", ());
            }
        })

        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
