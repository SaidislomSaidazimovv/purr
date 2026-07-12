use std::fs;
use std::sync::Mutex;

/// Last-seen line of the watched repo's `.git/logs/HEAD` reflog, used to
/// detect new activity between polls.
pub struct GitWatcherState(pub Mutex<Option<String>>);

fn read_last_head_log_line(repo_path: &str) -> Option<String> {
    let log_path = format!("{repo_path}/.git/logs/HEAD");
    let content = fs::read_to_string(log_path).ok()?;
    content.lines().last().map(|s| s.to_string())
}

/// Polled from the frontend every few seconds. Returns true the first time
/// a *new* commit (not just a checkout/pull/merge) shows up in the reflog
/// since the last call.
#[tauri::command]
pub fn check_new_commit(state: tauri::State<GitWatcherState>, repo_path: String) -> bool {
    let current = read_last_head_log_line(&repo_path);
    let mut last = state.0.lock().unwrap();

    let changed = match (&*last, &current) {
        (Some(prev), Some(curr)) => prev != curr && curr.contains("\tcommit"),
        _ => false,
    };

    *last = current;
    changed
}
