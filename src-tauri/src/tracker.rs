use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use windows::core::PWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

/// Executable filename (e.g. "chrome.exe") of the currently focused window,
/// or None if it can't be determined.
pub fn foreground_process_name() -> Option<String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

        let mut buffer = [0u16; 260];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(process);
        result.ok()?;

        let path = OsString::from_wide(&buffer[..size as usize]);
        path.to_string_lossy()
            .rsplit(['\\', '/'])
            .next()
            .map(|s| s.to_string())
    }
}

/// Seconds since the last keyboard/mouse input, system-wide.
pub fn idle_seconds() -> u64 {
    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if !GetLastInputInfo(&mut info).as_bool() {
            return 0;
        }
        let now = GetTickCount();
        let elapsed_ms = now.wrapping_sub(info.dwTime);
        (elapsed_ms as u64) / 1000
    }
}

/// Very coarse activity category, based on the foreground app's executable
/// name. Expanded over time; unknown apps fall back to "other".
/// `custom_work_apps` is the user's own additions (Settings window) that
/// count as "code" alongside the built-in list.
fn categorize(process_name: &str, custom_work_apps: &[String]) -> &'static str {
    let name = process_name.to_lowercase();
    const CODE_APPS: &[&str] = &[
        "code.exe",
        "devenv.exe",
        "idea64.exe",
        "pycharm64.exe",
        "sublime_text.exe",
        "notepad++.exe",
        "cursor.exe",
        "windsurf.exe",
        "rustrover64.exe",
    ];
    const BROWSER_APPS: &[&str] = &["chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "brave.exe"];
    const GAME_APPS: &[&str] = &["robloxplayerbeta.exe", "steam.exe", "valorant.exe", "leagueclientux.exe"];

    let is_custom_work_app = custom_work_apps.iter().any(|a| a.to_lowercase() == name);

    if CODE_APPS.contains(&name.as_str()) || is_custom_work_app {
        "code"
    } else if BROWSER_APPS.contains(&name.as_str()) {
        "browser"
    } else if GAME_APPS.contains(&name.as_str()) {
        "game"
    } else {
        "other"
    }
}

#[derive(serde::Serialize)]
pub struct ActivitySnapshot {
    pub process_name: Option<String>,
    pub category: &'static str,
    pub idle_seconds: u64,
}

#[tauri::command]
pub fn get_activity_snapshot(config_state: tauri::State<crate::config::ConfigState>) -> ActivitySnapshot {
    let process_name = foreground_process_name();
    let custom_work_apps = config_state.0.lock().unwrap().custom_work_apps.clone();
    let category = process_name
        .as_deref()
        .map(|n| categorize(n, &custom_work_apps))
        .unwrap_or("other");
    ActivitySnapshot {
        process_name,
        category,
        idle_seconds: idle_seconds(),
    }
}
