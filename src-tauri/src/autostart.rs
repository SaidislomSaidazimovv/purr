use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
    KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
};

/// Windows autostart via a HKCU Run registry key, written directly with the
/// `windows` crate (already a project dependency) rather than
/// `tauri-plugin-autostart` — that plugin has a confirmed, still-open bug
/// where the Run entry silently vanishes after the first reboot on Windows
/// (tauri-apps/plugins-workspace#771). config.json's `autostart_enabled` is
/// the source of truth for "should this be on"; the registry key is just an
/// effect reproduced from it, including once at every app startup (see
/// `reassert_on_startup`) so a vanished entry self-heals.
const RUN_KEY_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE_NAME: &str = "Purr";

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let path_wide = to_wide(RUN_KEY_PATH);
    let mut hkey = HKEY::default();
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(path_wide.as_ptr()),
            Some(0),
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut hkey,
            None,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(format!("registry kalitini ochib bo'lmadi: {status:?}"));
    }

    let name_wide = to_wide(RUN_VALUE_NAME);
    let result = if enabled {
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let quoted = format!("\"{}\"", exe_path.display());
        let value_wide = to_wide(&quoted);
        let bytes = unsafe {
            std::slice::from_raw_parts(value_wide.as_ptr().cast::<u8>(), value_wide.len() * 2)
        };
        unsafe { RegSetValueExW(hkey, PCWSTR(name_wide.as_ptr()), Some(0), REG_SZ, Some(bytes)) }
    } else {
        let r = unsafe { RegDeleteValueW(hkey, PCWSTR(name_wide.as_ptr())) };
        if r == ERROR_FILE_NOT_FOUND {
            ERROR_SUCCESS
        } else {
            r
        }
    };

    unsafe {
        let _ = RegCloseKey(hkey);
    }

    if result != ERROR_SUCCESS {
        return Err(format!("registry yozishda xato: {result:?}"));
    }
    Ok(())
}

/// Called once at every app startup (see lib.rs `setup()`) if config says
/// autostart should be on — re-writes the Run key even if it's presumably
/// already there, to self-heal from the #771-style disappearance.
pub fn reassert_on_startup(enabled: bool) {
    if enabled {
        let _ = set_autostart(true);
    }
}
