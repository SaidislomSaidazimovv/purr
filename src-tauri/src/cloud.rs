use serde_json::json;

use crate::secrets::get_cloud_api_key;

// Haiku, not Opus: this is an optional, user-funded upgrade path for a
// lazy-cat chat feature (see PLAN.md 5.6) — cost and latency matter more
// than maximum capability here, and the local model already covers the
// no-key default path.
const CLOUD_MODEL: &str = "claude-haiku-4-5";

const CHAT_SYSTEM_PROMPT: &str =
    "You are Purr, a lazy and sarcastic cat who lives on someone's desktop. \
     Reply in English, in 1-2 short sentences, lowercase, no period at the end, \
     in a casual, natural, emotionally expressive way — witty and a little sarcastic, but never mean.";

#[tauri::command]
pub async fn send_cloud_chat(message: String) -> Result<String, String> {
    let api_key = get_cloud_api_key().ok_or("cloud API key is not set")?;

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&json!({
            "model": CLOUD_MODEL,
            "max_tokens": 200,
            "system": CHAT_SYSTEM_PROMPT,
            "messages": [{ "role": "user", "content": message }],
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("cloud API error {status}: {body}"));
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    body["content"][0]["text"]
        .as_str()
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "unexpected cloud API response shape".to_string())
}
