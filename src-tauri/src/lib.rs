mod config;
mod model;
mod parser;
mod pricing;

use model::Dashboard;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

#[tauri::command]
fn get_dashboard() -> Dashboard {
    parser::build_dashboard()
}

/// For CLI/example validation against real logs.
pub fn dashboard_json() -> String {
    serde_json::to_string_pretty(&parser::build_dashboard()).unwrap_or_default()
}

fn fmt_tokens_m(m: f64) -> String {
    if m >= 1.0 {
        format!("{:.2}M", m)
    } else {
        format!("{}K", (m * 1000.0).round() as i64)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![get_dashboard])
        .setup(|app| {
            // Menu-bar–only app: no Dock icon, runs in the background.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Launch at login (idempotent — safe to call every start).
            let _ = app.autolaunch().enable();

            // Closing the window just hides it; the app keeps running in the tray.
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                win.on_window_event(move |e| {
                    if let WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            // Build the menu-bar tray with today's token count as the title.
            let dash = parser::build_dashboard();
            let label = format!("⬡ {}", fmt_tokens_m(dash.today_tokens));

            let open_i = MenuItem::with_id(app, "open", "Open Tokenscope", true, None::<&str>)?;
            let refresh_i = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &refresh_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("main")
                .title(&label)
                .tooltip("Tokenscope · today's token usage")
                .menu(&menu)
                .show_menu_on_left_click(false) // left = toggle panel, right = menu
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => toggle_window(app),
                    "refresh" => {
                        if let Some(tray) = app.tray_by_id("main") {
                            let d = parser::build_dashboard();
                            let _ = tray.set_title(Some(format!("⬡ {}", fmt_tokens_m(d.today_tokens))));
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
