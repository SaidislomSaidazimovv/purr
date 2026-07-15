mod autostart;
mod cloud;
mod config;
mod db;
mod git;
mod llm;
mod memcheck;
mod rules;
mod secrets;
mod tracker;
mod tray;
mod window;

use autostart::set_autostart;
use cloud::send_cloud_chat;
use config::{
    complete_onboarding, get_repo_path, get_settings, is_quiet_hours, load_or_init_config,
    set_settings, ConfigState,
};
use db::{get_event_count, log_event, open_db, DbState};
use git::{check_new_commit, GitWatcherState};
use llm::{get_llm_port, kill_on_exit, llm_status, start_llm, stop_llm, LlmState};
use memcheck::get_memory_status;
use rules::{get_phrase, RulesState};
use secrets::{clear_cloud_api_key, has_cloud_api_key, set_cloud_api_key};
use tauri::Manager;
use tracker::get_activity_snapshot;
use tray::setup_tray;
use window::{
    fit_to_primary_monitor, set_drag_active, show_onboarding_window, start_click_through_watcher,
    update_pet_bounds, DragActiveState, PetBoundsState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PetBoundsState(Default::default()))
        .manage(DragActiveState(Default::default()))
        .manage(GitWatcherState(Default::default()))
        .manage(RulesState(Default::default()))
        .manage(LlmState(Default::default()))
        .invoke_handler(tauri::generate_handler![
            update_pet_bounds,
            set_drag_active,
            get_activity_snapshot,
            check_new_commit,
            log_event,
            get_event_count,
            get_repo_path,
            get_phrase,
            get_memory_status,
            get_llm_port,
            llm_status,
            start_llm,
            stop_llm,
            send_cloud_chat,
            set_cloud_api_key,
            has_cloud_api_key,
            clear_cloud_api_key,
            get_settings,
            set_settings,
            is_quiet_hours,
            set_autostart,
            complete_onboarding
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            fit_to_primary_monitor(&handle);
            start_click_through_watcher(handle.clone());
            setup_tray(&handle)?;
            let conn = open_db(&handle).expect("failed to open sqlite db");
            app.manage(DbState(std::sync::Mutex::new(conn)));
            let cfg = load_or_init_config(&handle);
            autostart::reassert_on_startup(cfg.autostart_enabled);
            if !cfg.first_run_complete {
                let _ = show_onboarding_window(&handle);
            }
            app.manage(ConfigState(std::sync::Mutex::new(cfg)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<LlmState>() {
                    kill_on_exit(&state);
                }
            }
        });
}
