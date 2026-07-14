use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const DEFAULT_REPO_PATH: &str = "F:/Main and Private/PetApp";

#[derive(Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub repo_path: String,
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
/// first run. Lets the git-watcher repo path be changed by editing that file
/// directly, without needing a full Settings UI (that comes in Faza 4).
pub fn load_or_init_config(app: &AppHandle) -> AppConfig {
    let path = config_file_path(app);

    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<AppConfig>(&content) {
            return cfg;
        }
    }

    let default = AppConfig {
        repo_path: DEFAULT_REPO_PATH.to_string(),
    };
    let _ = fs::write(&path, serde_json::to_string_pretty(&default).unwrap());
    default
}

#[tauri::command]
pub fn get_repo_path(state: tauri::State<ConfigState>) -> String {
    state.0.lock().unwrap().repo_path.clone()
}

/// Called from the Advanced settings panel. Persists immediately so the new
/// path survives a restart, and updates in-memory state so the frontend can
/// switch the git watcher target without needing one.
#[tauri::command]
pub fn set_repo_path(
    app: tauri::AppHandle,
    state: tauri::State<ConfigState>,
    repo_path: String,
) -> Result<(), String> {
    let mut cfg = state.0.lock().unwrap();
    cfg.repo_path = repo_path;
    let path = config_file_path(&app);
    fs::write(&path, serde_json::to_string_pretty(&*cfg).unwrap()).map_err(|e| e.to_string())
}
