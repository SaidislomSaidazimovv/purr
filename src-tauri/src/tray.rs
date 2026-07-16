use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

use crate::window::open_settings_window;

const TRAY_ID: &str = "main-tray";

/// Faza 5.2: the Pomodoro timer itself lives in the frontend (App.tsx) —
/// this just holds the tray menu item handle so `set_pomodoro_status` can
/// relabel it (e.g. "Pomodoro: boshlash" -> "Pomodoro: pauza (24:12)").
pub struct PomodoroMenuState(pub MenuItem<tauri::Wry>);

/// Builds the system tray icon with show/hide + settings + Pomodoro + quit menu.
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Ko'rsat / Yashir", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Sozlamalar", true, None::<&str>)?;
    let pomodoro_toggle = MenuItem::with_id(
        app,
        "pomodoro_toggle",
        "Pomodoro: boshlash",
        true,
        None::<&str>,
    )?;
    let pomodoro_reset =
        MenuItem::with_id(app, "pomodoro_reset", "Pomodoro: bekor qilish", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Chiqish", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &settings, &pomodoro_toggle, &pomodoro_reset, &quit],
    )?;

    app.manage(PomodoroMenuState(pomodoro_toggle.clone()));

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().unwrap())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let visible = window.is_visible().unwrap_or(true);
                    let _ = if visible { window.hide() } else { window.show() };
                }
            }
            "settings" => {
                let _ = open_settings_window(app);
            }
            "pomodoro_toggle" => {
                let _ = app.emit_to("main", "pomodoro-toggle", ());
            }
            "pomodoro_reset" => {
                let _ = app.emit_to("main", "pomodoro-reset", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Called by the frontend whenever the Pomodoro state changes (start/pause/
/// resume/reset/phase switch/every tick while running) to keep the tray
/// menu label and hover tooltip in sync with what's actually running.
#[tauri::command]
pub fn set_pomodoro_status(app: AppHandle, label: String, tooltip: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(if tooltip.is_empty() { None } else { Some(tooltip.as_str()) });
    }
    if let Some(state) = app.try_state::<PomodoroMenuState>() {
        let _ = state.0.set_text(label);
    }
    Ok(())
}
