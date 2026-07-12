use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

pub struct DbState(pub Mutex<Connection>);

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Opens (creating if needed) the app's SQLite database in the standard
/// per-user app-data directory, and ensures the events table exists.
pub fn open_db(app: &AppHandle) -> rusqlite::Result<Connection> {
    let dir = app
        .path()
        .app_data_dir()
        .expect("app_data_dir should be resolvable");
    std::fs::create_dir_all(&dir).expect("failed to create app data dir");

    let conn = Connection::open(dir.join("purr.db"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            kind TEXT NOT NULL,
            category TEXT,
            process_name TEXT,
            idle_seconds INTEGER
        )",
        [],
    )?;
    Ok(conn)
}

#[tauri::command]
pub fn log_event(
    state: tauri::State<DbState>,
    kind: String,
    category: Option<String>,
    process_name: Option<String>,
    idle_seconds: Option<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "INSERT INTO events (ts, kind, category, process_name, idle_seconds) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![now_unix(), kind, category, process_name, idle_seconds],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_event_count(state: tauri::State<DbState>) -> Result<i64, String> {
    let conn = state.0.lock().unwrap();
    conn.query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}
