use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use windows::Win32::System::SystemInformation::GetLocalTime;

use crate::autostart;

const DEFAULT_REPO_PATH: &str = "F:/Main and Private/PetApp";
const DEFAULT_PET_SIZE: u32 = 80;
const DEFAULT_PET_SPEED: u32 = 60;
const DEFAULT_SKIN_ID: &str = "cat";

fn default_pet_size() -> u32 {
    DEFAULT_PET_SIZE
}
fn default_pet_speed() -> u32 {
    DEFAULT_PET_SPEED
}
fn default_quiet_hour() -> i32 {
    -1
}
fn default_skin_id() -> String {
    DEFAULT_SKIN_ID.to_string()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub repo_path: String,
    #[serde(default = "default_pet_size")]
    pub pet_size: u32,
    #[serde(default = "default_pet_speed")]
    pub pet_speed: u32,
    /// Extra process names (e.g. "myide.exe") counted as "code"/work
    /// category on top of the built-in list in tracker.rs.
    #[serde(default)]
    pub custom_work_apps: Vec<String>,
    /// Hour of day (0-23); -1 means "not set". When both are set and the
    /// current hour falls in [start, end), the rule engine stays quiet.
    #[serde(default = "default_quiet_hour")]
    pub quiet_hours_start: i32,
    #[serde(default = "default_quiet_hour")]
    pub quiet_hours_end: i32,
    #[serde(default)]
    pub autostart_enabled: bool,
    #[serde(default)]
    pub first_run_complete: bool,
    /// Which sprite set to render (folder name under public/sprites/,
    /// e.g. "cat", "dog"). A plain field for now — when Faza 5.3 (multiple
    /// pets) lands, each pet's initial skin seeds from this same value.
    #[serde(default = "default_skin_id")]
    pub skin_id: String,
}

pub struct ConfigState(pub Mutex<AppConfig>);

fn config_file_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("app_data_dir should be resolvable");
    fs::create_dir_all(&dir).expect("failed to create app data dir");
    dir.join("config.json")
}

/// Loads `config.json` from the app data dir, creating it with defaults on
/// first run.
pub fn load_or_init_config(app: &AppHandle) -> AppConfig {
    let path = config_file_path(app);

    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<AppConfig>(&content) {
            return cfg;
        }
    }

    let default = AppConfig {
        repo_path: DEFAULT_REPO_PATH.to_string(),
        pet_size: DEFAULT_PET_SIZE,
        pet_speed: DEFAULT_PET_SPEED,
        custom_work_apps: Vec::new(),
        quiet_hours_start: -1,
        quiet_hours_end: -1,
        autostart_enabled: false,
        first_run_complete: false,
        skin_id: DEFAULT_SKIN_ID.to_string(),
    };
    let _ = fs::write(&path, serde_json::to_string_pretty(&default).unwrap());
    default
}

fn persist(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let path = config_file_path(app);
    fs::write(&path, serde_json::to_string_pretty(cfg).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_repo_path(state: tauri::State<ConfigState>) -> String {
    state.0.lock().unwrap().repo_path.clone()
}

/// Whole-config load for the Settings window.
#[tauri::command]
pub fn get_settings(state: tauri::State<ConfigState>) -> AppConfig {
    state.0.lock().unwrap().clone()
}

/// Whole-config save from the Settings window's single "Saqlash" button.
/// Also re-asserts the Windows autostart registry key right away, rather
/// than waiting for the next launch.
#[tauri::command]
pub fn set_settings(
    app: tauri::AppHandle,
    state: tauri::State<ConfigState>,
    settings: AppConfig,
) -> Result<(), String> {
    autostart::set_autostart(settings.autostart_enabled)?;
    let mut cfg = state.0.lock().unwrap();
    *cfg = settings;
    persist(&app, &cfg)
}

/// Called once by the onboarding window's "Boshladik!" button — marks
/// first-run as done so the window never auto-shows again.
#[tauri::command]
pub fn complete_onboarding(
    app: tauri::AppHandle,
    state: tauri::State<ConfigState>,
) -> Result<(), String> {
    let mut cfg = state.0.lock().unwrap();
    cfg.first_run_complete = true;
    persist(&app, &cfg)
}

fn current_local_hour() -> u32 {
    let st = unsafe { GetLocalTime() };
    st.wHour as u32
}

/// True when the rule engine should stay quiet (not speak unsolicited
/// phrases). Direct chat replies to something the user typed are not
/// gated by this — only ambient/triggered speech is.
#[tauri::command]
pub fn is_quiet_hours(state: tauri::State<ConfigState>) -> bool {
    let cfg = state.0.lock().unwrap();
    let (start, end) = (cfg.quiet_hours_start, cfg.quiet_hours_end);
    if start < 0 || end < 0 {
        return false;
    }
    let hour = current_local_hour() as i32;
    if start <= end {
        hour >= start && hour < end
    } else {
        // Wraps past midnight, e.g. 23 -> 7.
        hour >= start || hour < end
    }
}
