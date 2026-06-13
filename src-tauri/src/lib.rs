mod config;
mod model;
mod parser;
mod pricing;
mod store;

use model::Dashboard;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
#[cfg(not(target_os = "macos"))]
use tauri::WindowEvent;
use std::time::Duration;
use tauri_plugin_autostart::ManagerExt;
// Positioner is only used for the non-macOS fallback; macOS positions the
// NSPanel manually (see position_panel).
#[cfg(not(target_os = "macos"))]
use tauri_plugin_positioner::{Position, WindowExt};
// NSPanel: lets the popover float over apps in native fullscreen (a plain
// NSWindow from a background/Accessory app cannot overlay another app's
// fullscreen Space). `get_webview_panel` / `to_panel` come from these traits.
#[cfg(target_os = "macos")]
use tauri_nspanel::{ManagerExt as _, WebviewWindowExt as _};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Rebuild the dashboard (incremental), update the tray's token count, and push
/// the fresh data to the UI so an open popover updates live.
fn refresh(app: &tauri::AppHandle) {
    let dash = parser::build_dashboard();
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(Some(fmt_tokens_m(dash.today_tokens)));
    }
    let _ = app.emit("dashboard-updated", &dash);
}

/// Last tray-icon rectangle (physical px: x, y, width, height), captured on tray
/// click. Used to anchor the panel like tauri-plugin-positioner's
/// TrayBottomCenter — but we can't use the positioner itself on a swizzled
/// NSPanel: its calculate_position calls current_monitor().unwrap(), which fails
/// for a hidden/panel window, so positioning silently no-ops (panel stays
/// top-left). We also must add the icon height ourselves (see position_panel).
#[cfg(target_os = "macos")]
struct TrayAnchor(std::sync::Mutex<Option<(f64, f64, f64, f64)>>);

/// Anchor the panel under the tray icon, top flush with the menu-bar bottom:
///   x = tray_x + tray_width/2 − window_width/2
///   y = tray_y + tray_height
/// The tray rect's y is the icon *top* (≈ screen top, 0); adding its height
/// lands the panel just below the menu bar. (tauri-plugin-positioner gets away
/// with y = tray_y because macOS auto-constrains a normal window out from under
/// the menu bar — but a floating NSPanel isn't constrained, so we offset it
/// ourselves.) All physical px; no monitor lookup, so it works while hidden.
#[cfg(target_os = "macos")]
fn position_panel(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    let Ok(size) = w.outer_size() else {
        return;
    };
    let win_w = size.width as f64;

    if let Some(state) = app.try_state::<TrayAnchor>() {
        if let Some((tx, ty, tw, th)) = *state.0.lock().unwrap() {
            let x = tx + tw / 2.0 - win_w / 2.0;
            let y = ty + th;
            let _ = w.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
            return;
        }
    }

    // Fallback (e.g. opened from the menu before any tray click): centre near
    // the top of the current monitor.
    if let Ok(Some(monitor)) = w.current_monitor() {
        let mp = monitor.position();
        let ms = monitor.size();
        let x = mp.x as f64 + (ms.width as f64 - win_w) / 2.0;
        let y = mp.y as f64 + 24.0 * monitor.scale_factor();
        let _ = w.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
    }
}

/// True if our (Accessory) app is currently the frontmost application.
#[cfg(target_os = "macos")]
fn app_is_frontmost() -> bool {
    use tauri_nspanel::cocoa::base::id;
    use tauri_nspanel::objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let proc_info: id = msg_send![class!(NSProcessInfo), processInfo];
        let our_pid: i32 = msg_send![proc_info, processIdentifier];
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let front: id = msg_send![workspace, frontmostApplication];
        if front.is_null() {
            return false;
        }
        let front_pid: i32 = msg_send![front, processIdentifier];
        front_pid == our_pid
    }
}

/// Hide the panel when the user switches Space or activates another app, so it
/// doesn't linger over the new (e.g. fullscreen) Space until the next click.
/// resign-key alone misses pure Space switches because the panel joins all
/// Spaces and can stay key across the transition.
#[cfg(target_os = "macos")]
fn hide_panel_on_context_switch(app: &tauri::AppHandle) {
    if app_is_frontmost() {
        return;
    }
    if let Ok(panel) = app.get_webview_panel("main") {
        if panel.is_visible() {
            panel.order_out(None);
        }
    }
}

/// Register NSWorkspace observers that auto-hide the panel on Space change / app
/// activation (mirrors tauri-nspanel's menu-bar example). The observers live for
/// the whole app lifetime, so the returned tokens are intentionally dropped.
#[cfg(target_os = "macos")]
fn register_panel_autohide(app: &tauri::AppHandle) {
    use std::ffi::CString;
    use tauri_nspanel::block::ConcreteBlock;
    use tauri_nspanel::cocoa::base::{id, nil};
    use tauri_nspanel::objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
        let center: id = msg_send![workspace, notificationCenter];
        for name in [
            "NSWorkspaceActiveSpaceDidChangeNotification",
            "NSWorkspaceDidActivateApplicationNotification",
        ] {
            let app = app.clone();
            let block = ConcreteBlock::new(move |_notif: id| {
                hide_panel_on_context_switch(&app);
            });
            let block = block.copy();
            let ns_name: id = msg_send![
                class!(NSString),
                stringWithUTF8String: CString::new(name).unwrap().as_ptr()
            ];
            let _: id = msg_send![
                center,
                addObserverForName: ns_name object: nil queue: nil usingBlock: block
            ];
        }
    }
}

/// Show the panel as a popover anchored under the tray icon, and focus it.
/// Always reset the scroll to the top so it doesn't reopen mid-scroll.
fn show_popover(app: &tauri::AppHandle) {
    // On macOS the window is an NSPanel — position it manually, then show()
    // (makes it key and orders it front, incl. over fullscreen Spaces).
    #[cfg(target_os = "macos")]
    {
        position_panel(app);
        if let Ok(panel) = app.get_webview_panel("main") {
            panel.show();
        }
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.move_window(Position::TrayBottomCenter);
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(
            "(function(){var e=document.querySelector('.om-scroll');if(e){e.scrollTop=0;}else{window.scrollTo(0,0);}})()",
        );
    }
}

#[tauri::command]
fn get_dashboard(app: tauri::AppHandle) -> Dashboard {
    let dash = parser::build_dashboard();
    // Sync the tray count to this freshly-fetched value. The panel refetches the
    // instant it opens, while the tray otherwise only refreshes every 30s — so
    // without this the two could disagree for up to 30s during heavy usage.
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(Some(fmt_tokens_m(dash.today_tokens)));
    }
    dash
}

/// For CLI/example validation against real logs.
pub fn dashboard_json() -> String {
    serde_json::to_string_pretty(&parser::build_dashboard()).unwrap_or_default()
}

fn fmt_tokens_m(m: f64) -> String {
    if m >= 1.0 {
        format!("{:.2}M", m)
    } else {
        let k = (m * 1000.0).round() as i64;
        // no usage yet (e.g. just past midnight) — "0K" reads like "OK", so
        // show a clearer idle label instead.
        if k <= 0 {
            "Ready".to_string()
        } else {
            format!("{k}K")
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Tracks when the popover was last hidden, so a click on the tray icon
    // while it's open (which first blurs/hides it) doesn't immediately reopen.
    let last_hidden = Arc::new(AtomicI64::new(0));

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        // Must be the FIRST plugin: a second launch (e.g. reinstall/relaunch)
        // hands off to the already-running instance and exits, so the menu bar
        // never shows two icons.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_popover(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    // Registers the WebviewPanelManager state used by `to_panel`/`get_webview_panel`.
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![get_dashboard])
        .setup(move |app| {
            // Menu-bar–only app: no Dock icon, runs in the background.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Holds the latest tray-icon rect so show_popover can anchor the panel.
            #[cfg(target_os = "macos")]
            app.manage(TrayAnchor(std::sync::Mutex::new(None)));

            // Launch at login (idempotent — safe to call every start).
            let _ = app.autolaunch().enable();

            // Popover behaviour. On macOS, convert the window to a non-activating
            // NSPanel so it can float over apps in native fullscreen, and hide it
            // on resign-key (clicking outside / switching apps) like a popover.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
                // NSWindowStyleMaskNonActivatingPanel — receive events without
                // activating (stealing focus from) the frontmost app.
                #[allow(non_upper_case_globals)]
                const NS_NONACTIVATING_PANEL: i32 = 1 << 7;

                let lh = last_hidden.clone();
                let handle = app.handle().clone();
                let delegate = tauri_nspanel::panel_delegate!(TokenscopePanelDelegate {
                    window_did_resign_key
                });
                delegate.set_listener(Box::new(move |name: String| {
                    if name == "window_did_resign_key" {
                        lh.store(now_ms(), Ordering::Relaxed);
                        if let Ok(panel) = handle.get_webview_panel("main") {
                            panel.order_out(None);
                        }
                    }
                }));

                if let Ok(panel) = window.to_panel() {
                    panel.set_level(25); // NSMainMenuWindowLevel (24) + 1
                    panel.set_style_mask(NS_NONACTIVATING_PANEL);
                    // MoveToActiveSpace: the panel relocates onto whatever Space
                    // is active *when shown* — so it appears over a fullscreen app
                    // if you open it there, but it does NOT live on every Space.
                    // (CanJoinAllSpaces + Stationary made it omnipresent and kept
                    // it painted through transitions, so it lingered/ghosted over
                    // a fullscreen Space even after order_out.) FullScreenAuxiliary
                    // is what actually permits coexisting with a fullscreen window.
                    panel.set_collection_behaviour(
                        NSWindowCollectionBehavior::NSWindowCollectionBehaviorMoveToActiveSpace
                            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
                    );
                    panel.set_delegate(delegate);
                }

                // Also hide on Space change / app activation, not just resign-key.
                register_panel_autohide(app.handle());
            }

            // Non-macOS: keep the plain window, hide on focus loss.
            #[cfg(not(target_os = "macos"))]
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                let lh = last_hidden.clone();
                win.on_window_event(move |e| match e {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        lh.store(now_ms(), Ordering::Relaxed);
                        let _ = w.hide();
                    }
                    WindowEvent::Focused(false) => {
                        lh.store(now_ms(), Ordering::Relaxed);
                        let _ = w.hide();
                    }
                    _ => {}
                });
            }

            // Build the menu-bar tray: app glyph (template icon) + today's tokens.
            let dash = parser::build_dashboard();
            let label = fmt_tokens_m(dash.today_tokens);

            let open_i = MenuItem::with_id(app, "open", "Open Tokenscope", true, None::<&str>)?;
            let refresh_i = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &refresh_i, &quit_i])?;

            let lh_tray = last_hidden.clone();
            let _tray = TrayIconBuilder::with_id("main")
                .icon(tauri::include_image!("icons/tray-icon.png"))
                .icon_as_template(false)
                .title(&label)
                .tooltip("Tokenscope · today's token usage")
                .menu(&menu)
                .show_menu_on_left_click(false) // left = toggle panel, right = menu
                .on_tray_icon_event(move |tray, event| {
                    let app = tray.app_handle();
                    tauri_plugin_positioner::on_tray_event(app, &event);
                    // Cache the tray-icon rect (physical px) for panel positioning.
                    #[cfg(target_os = "macos")]
                    if let TrayIconEvent::Click { rect, .. } = &event {
                        if let Some(anchor) = app.try_state::<TrayAnchor>() {
                            let p = rect.position.to_physical::<f64>(1.0);
                            let s = rect.size.to_physical::<f64>(1.0);
                            *anchor.0.lock().unwrap() = Some((p.x, p.y, s.width, s.height));
                        }
                    }
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        // if it was just hidden by the blur from this same click, leave it closed
                        let just_hidden = now_ms() - lh_tray.load(Ordering::Relaxed) < 250;
                        #[cfg(target_os = "macos")]
                        {
                            let visible = app
                                .get_webview_panel("main")
                                .map(|p| p.is_visible())
                                .unwrap_or(false);
                            if visible {
                                if let Ok(p) = app.get_webview_panel("main") {
                                    p.order_out(None);
                                }
                            } else if !just_hidden {
                                show_popover(app);
                            }
                        }
                        #[cfg(not(target_os = "macos"))]
                        {
                            let visible = app
                                .get_webview_window("main")
                                .and_then(|w| w.is_visible().ok())
                                .unwrap_or(false);
                            if visible {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.hide();
                                }
                            } else if !just_hidden {
                                show_popover(app);
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_popover(app),
                    "refresh" => refresh(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Background refresh: keep the tray's token count current and push
            // live updates to an open popover. Cheap thanks to incremental ingest.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(30));
                refresh(&handle);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
