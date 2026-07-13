use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use crate::memcheck::get_memory_status;

/// Fixed local port for the llama-server sidecar. Chosen away from Vite's
/// dev port (1420) and our earlier manual test port.
pub const LLM_PORT: u16 = 8811;

/// Below this much free RAM, we refuse to start the (RAM-heavy) sidecar
/// rather than risk an OOM crash — this machine is frequently under 1GB
/// free with only everyday apps open.
const MIN_FREE_MB_TO_START: u64 = 1200;

pub struct LlmState(pub Mutex<Option<Child>>);

// Dev-only path resolution: binaries/ and models/ live at the project root,
// one level up from src-tauri/. Revisit for Faza 4, when the model and
// server binary get bundled into the installer instead.
fn server_exe_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../binaries/extracted/llama-server.exe")
}

fn model_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../models/qwen2.5-1.5b-instruct-q4_k_m.gguf")
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
pub fn start_llm(state: tauri::State<LlmState>) -> Result<String, String> {
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

    let exe = server_exe_path();
    let model = model_path();
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
