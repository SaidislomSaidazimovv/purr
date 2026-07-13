use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

#[derive(serde::Serialize)]
pub struct MemoryStatus {
    pub total_mb: u64,
    pub free_mb: u64,
    pub free_percent: f64,
}

/// Real physical RAM status via the same Win32 API Task Manager uses.
/// Used to gate starting the (RAM-heavy) local LLM sidecar — this machine
/// has only 7.31GB total and is frequently under 1GB free.
#[tauri::command]
pub fn get_memory_status() -> MemoryStatus {
    unsafe {
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        let _ = GlobalMemoryStatusEx(&mut status);

        let total_mb = status.ullTotalPhys / (1024 * 1024);
        let free_mb = status.ullAvailPhys / (1024 * 1024);
        let free_percent = if total_mb > 0 {
            (free_mb as f64 / total_mb as f64) * 100.0
        } else {
            0.0
        };

        MemoryStatus {
            total_mb,
            free_mb,
            free_percent,
        }
    }
}
