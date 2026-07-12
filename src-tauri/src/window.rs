use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

/// Pet's current bounding box in physical screen pixels.
#[derive(Default, Clone, Copy)]
pub struct PetBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub struct PetBoundsState(pub Mutex<PetBounds>);

/// While true, the window stays fully interactive regardless of cursor
/// position — set during drag so a fast mouse movement can't outrun the
/// pet's bounding box and cause the webview to stop receiving events.
pub struct DragActiveState(pub Mutex<bool>);

/// Called from the frontend whenever the pet moves or resizes, in physical
/// screen pixels (window position + CSS position * scale factor).
#[tauri::command]
pub fn update_pet_bounds(
    state: tauri::State<PetBoundsState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) {
    let mut bounds = state.0.lock().unwrap();
    *bounds = PetBounds {
        x,
        y,
        width,
        height,
    };
}

#[tauri::command]
pub fn set_drag_active(state: tauri::State<DragActiveState>, active: bool) {
    *state.0.lock().unwrap() = active;
}

/// Polls the OS cursor position ~60Hz and toggles the window's
/// ignore-cursor-events flag depending on whether the cursor is over the
/// pet's current bounding box. This is what makes clicks "pass through" the
/// transparent overlay everywhere except on the pet itself.
pub fn start_click_through_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut is_ignoring = true;

        loop {
            thread::sleep(Duration::from_millis(16));

            let mut point = POINT::default();
            if unsafe { GetCursorPos(&mut point) }.is_err() {
                continue;
            }

            let bounds_state = app.state::<PetBoundsState>();
            let bounds = *bounds_state.0.lock().unwrap();
            let drag_state = app.state::<DragActiveState>();
            let dragging = *drag_state.0.lock().unwrap();

            let cursor_x = point.x as f64;
            let cursor_y = point.y as f64;

            let inside = bounds.width > 0.0
                && bounds.height > 0.0
                && cursor_x >= bounds.x
                && cursor_x <= bounds.x + bounds.width
                && cursor_y >= bounds.y
                && cursor_y <= bounds.y + bounds.height;

            let should_ignore = !inside && !dragging;
            if should_ignore != is_ignoring {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_ignore_cursor_events(should_ignore);
                }
                is_ignoring = should_ignore;
            }
        }
    });
}

/// Resizes and positions the main window to cover the entire primary
/// monitor, so the pet can walk/be dragged anywhere on screen.
pub fn fit_to_primary_monitor(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };

    let size = monitor.size();
    let position = monitor.position();

    let _ = window.set_position(tauri::PhysicalPosition::new(position.x, position.y));
    let _ = window.set_size(tauri::PhysicalSize::new(size.width, size.height));
}
