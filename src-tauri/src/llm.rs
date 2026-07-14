use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::Manager;

use crate::memcheck::get_memory_status;

/// Fixed local port for the llama-server sidecar. Chosen away from Vite's
/// dev port (1420) and our earlier manual test port.
pub const LLM_PORT: u16 = 8811;

/// Below this much free RAM, we refuse to start the (RAM-heavy) sidecar
/// rather than risk an OOM crash — this machine is frequently under 1GB
/// free with only everyday apps open.
const MIN_FREE_MB_TO_START: u64 = 1200;

pub struct LlmState(pub Mutex<Option<Child>>);

// Resolves against the bundled `resources` (see tauri.conf.json ->
// bundle.resources) when running as an installed app, since a packaged
// build has no `CARGO_MANIFEST_DIR` project tree to find these in.
// `tauri dev` doesn't copy resources, so it falls back to the project's
// binaries/models folders one level up from src-tauri/.
fn resolve_resource(app: &tauri::AppHandle, bundled_rel: &str, dev_rel: &str) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join(bundled_rel);
        if bundled.exists() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(dev_rel)
}

fn server_exe_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_resource(
        app,
        "binaries/llama-server.exe",
        "../binaries/extracted/llama-server.exe",
    )
}

fn model_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_resource(
        app,
        "models/qwen2.5-1.5b-instruct-q4_k_m.gguf",
        "../models/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    )
}

#[tauri::command]
pub fn get_llm_port() -> u16 {
    LLM_PORT
}

#[tauri::command]
pub fn llm_status(state: tauri::State<LlmState>) -> bool {
    let mut guard = state.0.lock().unwrap();
    match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(None) => true,
            _ => {
                *guard = None;
                false
            }
        },
        None => false,
    }
}

#[tauri::command]
pub fn start_llm(app: tauri::AppHandle, state: tauri::State<LlmState>) -> Result<String, String> {
    let mut guard = state.0.lock().unwrap();

    if let Some(child) = guard.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok("already_running".to_string());
        }
    }

    let mem = get_memory_status();
    if mem.free_mb < MIN_FREE_MB_TO_START {
        return Err(format!(
            "RAM yetarli emas: {}MB bo'sh (kamida {}MB kerak)",
            mem.free_mb, MIN_FREE_MB_TO_START
        ));
    }

    let exe = server_exe_path(&app);
    let model = model_path(&app);
    if !exe.exists() {
        return Err(format!("llama-server topilmadi: {}", exe.display()));
    }
    if !model.exists() {
        return Err(format!("model fayli topilmadi: {}", model.display()));
    }

    let child = Command::new(&exe)
        .arg("-m")
        .arg(&model)
        .arg("--ctx-size")
        .arg("2048")
        .arg("--port")
        .arg(LLM_PORT.to_string())
        .arg("--n-gpu-layers")
        .arg("0")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    *guard = Some(child);
    Ok("started".to_string())
}

#[tauri::command]
pub fn stop_llm(state: tauri::State<LlmState>) {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Called on app exit — a child process is not automatically killed when
/// its Windows parent dies, so without this llama-server.exe would keep
/// running (and holding ~1GB+ RAM) in the background after Purr closes.
pub fn kill_on_exit(state: &LlmState) {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
