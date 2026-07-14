use keyring::Entry;

/// Windows Credential Manager entry for the user's own Claude API key —
/// only used if they opt into cloud AI in the Advanced settings panel.
/// Never touched by the default local-LLM path.
const SERVICE: &str = "com.purr.app";
const ACCOUNT: &str = "anthropic-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_cloud_api_key(key: String) -> Result<(), String> {
    entry()?.set_password(key.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_cloud_api_key() -> bool {
    matches!(entry().and_then(|e| e.get_password().map_err(|e| e.to_string())), Ok(_))
}

#[tauri::command]
pub fn clear_cloud_api_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn get_cloud_api_key() -> Option<String> {
    entry().ok()?.get_password().ok()
}
