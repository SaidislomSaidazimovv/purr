mod git;
mod tracker;
mod tray;
mod window;

use git::{check_new_commit, GitWatcherState};
use tracker::get_activity_snapshot;
use tray::setup_tray;
use window::{
    fit_to_primary_monitor, set_drag_active, start_click_through_watcher, update_pet_bounds,
    DragActiveState, PetBoundsState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PetBoundsState(Default::default()))
        .manage(DragActiveState(Default::default()))
        .manage(GitWatcherState(Default::default()))
        .invoke_handler(tauri::generate_handler![
            update_pet_bounds,
            set_drag_active,
            get_activity_snapshot,
            check_new_commit
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            fit_to_primary_monitor(&handle);
            start_click_through_watcher(handle.clone());
            setup_tray(&handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
