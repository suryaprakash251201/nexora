use tauri::{Emitter, Manager};
use std::sync::atomic::{AtomicBool, Ordering};

static SLEEP_INHIBITED: AtomicBool = AtomicBool::new(false);

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
/// Uses platform-specific APIs to prevent the system from sleeping.
#[tauri::command]
async fn set_sleep_inhibition(inhibit: bool, app: tauri::AppHandle) -> Result<(), String> {
    if inhibit == SLEEP_INHIBITED.load(Ordering::SeqCst) {
        return Ok(());
    }
    SLEEP_INHIBITED.store(inhibit, Ordering::SeqCst);

    #[cfg(target_os = "linux")]
    {
        // Use systemd-inhibit or xdg-desktop-portal via dbus on Linux.
        // For simplicity, we spawn a dbus-send to inhibit sleep.
        use std::process::Command;
        if inhibit {
            let _ = Command::new("systemd-inhibit")
                .args(["--what=idle:sleep", "--who=Nexora", "--why=File transfers active", "--mode=block", "sleep", "inf"])
                .spawn();
        } else {
            // Kill any systemd-inhibit processes we started
            let _ = Command::new("pkill")
                .args(["-f", "systemd-inhibit.*Nexora"])
                .output();
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Use SetThreadExecutionState on Windows
        unsafe {
            #[link(name = "kernel32")]
            extern "system" {
                fn SetThreadExecutionState(flags: u32) -> u32;
            }
            const ES_CONTINUOUS: u32 = 0x80000000;
            const ES_SYSTEM_REQUIRED: u32 = 0x00000001;
            const ES_DISPLAY_REQUIRED: u32 = 0x00000002;
            if inhibit {
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
            } else {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Use caffeinate on macOS
        use std::process::Command;
        if inhibit {
            let _ = Command::new("caffeinate")
                .args(["-dims", "&"])
                .spawn();
        } else {
            let _ = Command::new("pkill")
                .args(["-f", "caffeinate.*Nexora"])
                .output();
        }
    }

    if inhibit {
        eprintln!("[nexora] Preventing system sleep (transfers active)");
    } else {
        eprintln!("[nexora] Allowing system sleep");
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Log startup info to stderr for debugging when running from terminal
    eprintln!(
        "[nexora] Starting Nexora Desktop v{} on {}/{}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    );

    // Set a custom panic hook to capture startup crashes
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("[nexora] PANIC: {}", panic_info);
        // Try to log to a file in the app data directory
        if let Some(msg) = panic_info.payload().downcast_ref::<&str>() {
            let _ = std::fs::write(
                std::env::temp_dir().join("nexora-crash.log"),
                format!("Panic: {}\n{:?}", msg, panic_info.location()),
            );
        } else if let Some(msg) = panic_info.payload().downcast_ref::<String>() {
            let _ = std::fs::write(
                std::env::temp_dir().join("nexora-crash.log"),
                format!("Panic: {}\n{:?}", msg, panic_info.location()),
            );
        }
    }));

    let builder = tauri::Builder::default()
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
                let app = window.app_handle();
                let _ = app.emit("nexora:app-closing", ());
            }
        });

    // Run with better error reporting
    if let Err(e) = builder.run(tauri::generate_context!()) {
        eprintln!("[nexora] Fatal error: {}", e);
        // Also write to crash log file
        let _ = std::fs::write(
            std::env::temp_dir().join("nexora-error.log"),
            format!(
                "Nexora Desktop v{} - Fatal error\nPlatform: {}/{}\nError: {}\n",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS,
                std::env::consts::ARCH,
                e
            ),
        );
        std::process::exit(1);
    }
}
