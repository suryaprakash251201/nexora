use tauri::{Emitter, Manager};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

static SLEEP_INHIBITED: AtomicBool = AtomicBool::new(false);
/// PID of the platform inhibitor process we spawned (macOS `caffeinate` /
/// Linux `systemd-inhibit`). Stored so release can stop exactly that process
/// — no fragile `pkill -f` pattern matching that can miss or over-kill.
static INHIBIT_PID: Mutex<Option<u32>> = Mutex::new(None);
/// Set once the system tray was successfully created. When true, closing the
/// window hides it to the tray instead of quitting (standard media-app UX).
static TRAY_READY: AtomicBool = AtomicBool::new(false);

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

    if inhibit {
        // Spawn a platform inhibitor and remember its PID so release can stop
        // exactly that process (no pkill pattern matching).
        #[cfg(target_os = "linux")]
        {
            // systemd-inhibit runs `sleep infinity` under an idle+sleep lock;
            // the lock is released when the process is killed.
            use std::process::Command;
            if let Ok(child) = Command::new("systemd-inhibit")
                .args([
                    "--what=idle:sleep",
                    "--who=Nexora",
                    "--why=File transfers active",
                    "--mode=block",
                    "sleep",
                    "infinity",
                ])
                .spawn()
            {
                *INHIBIT_PID.lock().unwrap() = Some(child.id());
            }
        }

        #[cfg(target_os = "windows")]
        {
            // SetThreadExecutionState is a flag, not a process — no PID needed.
            unsafe {
                #[link(name = "kernel32")]
                extern "system" {
                    fn SetThreadExecutionState(flags: u32) -> u32;
                }
                const ES_CONTINUOUS: u32 = 0x80000000;
                const ES_SYSTEM_REQUIRED: u32 = 0x00000001;
                const ES_DISPLAY_REQUIRED: u32 = 0x00000002;
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
            }
        }

        #[cfg(target_os = "macos")]
        {
            // `caffeinate -dims` with NO trailing utility runs until killed.
            // (The old `-dims &` passed "&" as a command argument, making
            // caffeinate try to exec "&" as a utility and exit immediately —
            // inhibition silently never engaged on macOS.)
            use std::process::Command;
            if let Ok(child) = Command::new("caffeinate").args(["-dims"]).spawn() {
                *INHIBIT_PID.lock().unwrap() = Some(child.id());
            }
        }

        eprintln!("[nexora] Preventing system sleep (transfers active)");
    } else {
        #[cfg(not(target_os = "windows"))]
        {
            // Stop exactly the inhibitor we started (SIGTERM). On Linux this
            // releases the systemd-inhibit lock; on macOS it stops caffeinate.
            use std::process::Command;
            if let Some(pid) = INHIBIT_PID.lock().unwrap().take() {
                let _ = Command::new("kill").arg(pid.to_string()).output();
            }
        }

        #[cfg(target_os = "windows")]
        {
            unsafe {
                #[link(name = "kernel32")]
                extern "system" {
                    fn SetThreadExecutionState(flags: u32) -> u32;
                }
                const ES_CONTINUOUS: u32 = 0x80000000;
                SetThreadExecutionState(ES_CONTINUOUS);
            }
        }

        eprintln!("[nexora] Allowing system sleep");
    }
    Ok(())
}

/// Builds the system tray with Show / Play-Pause / Quit actions.
/// Left-clicking the tray icon also brings the main window to the foreground.
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Show Nexora", true, None::<&str>)?;
    let playpause = MenuItem::with_id(app, "playpause", "Play / Pause", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Nexora", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &playpause, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no default window icon"))?;

    TrayIconBuilder::with_id("nexora-tray")
        .icon(icon)
        .tooltip("Nexora")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "playpause" => {
                let _ = app.emit("nexora:tray-play-pause", ());
            }
            "quit" => {
                let _ = app.emit("nexora:app-closing", ());
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    TRAY_READY.store(true, Ordering::SeqCst);
    eprintln!("[nexora] System tray ready (close-to-tray enabled)");
    Ok(())
}

/// Shows, unminimizes and focuses the main window.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
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
        .plugin(tauri_plugin_fs::init())
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
            // A second instance was launched (e.g. user clicked the launcher
            // again). Bring the existing window back to the foreground —
            // including the case where it is currently hidden in the tray.
            show_main_window(app);
        }))

        // ── Custom commands ──────────────────────────────────────
        .invoke_handler(tauri::generate_handler![get_platform, set_sleep_inhibition])

        // ── System tray (created after the event loop starts) ────
        .setup(|app| {
            if let Err(e) = setup_tray(app.handle()) {
                // Tray unsupported (e.g. some Wayland setups): the window close
                // button then quits the app normally instead of hiding to tray.
                eprintln!("[nexora] Tray unavailable, closing window will quit: {}", e);
            }
            Ok(())
        })

        // ── App event handling ───────────────────────────────────
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let app = window.app_handle();
                    if TRAY_READY.load(Ordering::SeqCst) {
                        // Hide to tray so playback and transfers keep running.
                        let _ = window.hide();
                        // Tell the frontend to notify the user that the app is
                        // still alive (avoids the "did it close?" confusion).
                        let _ = app.emit("nexora:hidden-to-tray", ());
                        api.prevent_close();
                    } else {
                        let _ = app.emit("nexora:app-closing", ());
                    }
                }
                _ => {}
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
