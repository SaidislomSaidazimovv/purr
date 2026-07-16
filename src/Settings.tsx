import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AppConfig {
  repo_path: string;
  pet_size: number;
  pet_speed: number;
  custom_work_apps: string[];
  quiet_hours_start: number;
  quiet_hours_end: number;
  autostart_enabled: boolean;
  skin_id: string;
}

// Faza 5.1: skin shop. Each entry is a folder under public/sprites/<id>/.
const SKINS = [
  { id: "cat", label: "Mushuk" },
  { id: "dog", label: "It" },
];

// Real decorated/resizable OS window (see window.rs::open_settings_window),
// not the old overlay panel — no click-away/Escape dismiss logic needed
// here, the window has its own title bar and close button.
function Settings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [workAppsText, setWorkAppsText] = useState("");
  const [cloudKeyInput, setCloudKeyInput] = useState("");
  const [cloudKeySet, setCloudKeySet] = useState(false);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    invoke<AppConfig>("get_settings")
      .then((cfg) => {
        setConfig(cfg);
        setWorkAppsText(cfg.custom_work_apps.join("\n"));
      })
      .catch((e) => setLoadError(String(e)));
    invoke<boolean>("has_cloud_api_key")
      .then(setCloudKeySet)
      .catch(() => {});
  }, []);

  const save = useCallback(() => {
    if (!config) return;
    const updated: AppConfig = {
      ...config,
      custom_work_apps: workAppsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    invoke("set_settings", { settings: updated })
      .then(() => {
        setConfig(updated);
        setStatus(
          "saqlandi — pet o'lchami/tezligi/skin keyingi ishga tushirishda kuchga kiradi",
        );
      })
      .catch((e) => setStatus(`xato: ${String(e)}`));
  }, [config, workAppsText]);

  const saveCloudKey = useCallback(() => {
    const trimmed = cloudKeyInput.trim();
    if (!trimmed) return;
    invoke("set_cloud_api_key", { key: trimmed })
      .then(() => {
        setCloudKeyInput("");
        setCloudKeySet(true);
        setStatus("cloud AI key saqlandi");
      })
      .catch((e) => setStatus(`xato: ${String(e)}`));
  }, [cloudKeyInput]);

  const removeCloudKey = useCallback(() => {
    invoke("clear_cloud_api_key")
      .then(() => {
        setCloudKeySet(false);
        setStatus("cloud AI key o'chirildi");
      })
      .catch((e) => setStatus(`xato: ${String(e)}`));
  }, []);

  if (loadError) {
    return (
      <div style={{ padding: 20, fontFamily: "sans-serif", color: "#c00" }}>
        sozlamalarni yuklashda xato: {loadError}
      </div>
    );
  }
  if (!config) {
    return (
      <div style={{ padding: 20, fontFamily: "sans-serif", color: "#222" }}>yuklanmoqda...</div>
    );
  }

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", fontSize: 13, color: "#222" }}>
      <h2 style={{ marginTop: 0 }}>Purr sozlamalari</h2>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Pet</legend>
        <label style={{ display: "block", marginBottom: 8 }}>
          O'lchami (px)
          <input
            type="number"
            min={40}
            max={200}
            value={config.pet_size}
            onChange={(e) => setConfig({ ...config, pet_size: Number(e.target.value) })}
            style={{ width: "100%", padding: 6, boxSizing: "border-box" }}
          />
        </label>
        <label style={{ display: "block" }}>
          Yurish tezligi (px/s)
          <input
            type="number"
            min={0}
            max={300}
            value={config.pet_speed}
            onChange={(e) => setConfig({ ...config, pet_speed: Number(e.target.value) })}
            style={{ width: "100%", padding: 6, boxSizing: "border-box" }}
          />
        </label>
      </fieldset>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Skin</legend>
        <div style={{ display: "flex", gap: 10 }}>
          {SKINS.map((skin) => (
            <button
              key={skin.id}
              onClick={() => setConfig({ ...config, skin_id: skin.id })}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: 8,
                width: 72,
                borderRadius: 8,
                cursor: "pointer",
                border:
                  config.skin_id === skin.id ? "2px solid #222" : "2px solid transparent",
                background: config.skin_id === skin.id ? "#eee" : "transparent",
              }}
            >
              <img
                src={`/sprites/${skin.id}/idle/1.png`}
                alt={skin.label}
                style={{ width: 48, height: 48, objectFit: "contain" }}
              />
              <span>{skin.label}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Ish (git kuzatuvi)</legend>
        <label style={{ display: "block", marginBottom: 8 }}>
          Git repo yo'li
          <input
            value={config.repo_path}
            onChange={(e) => setConfig({ ...config, repo_path: e.target.value })}
            style={{ width: "100%", padding: 6, boxSizing: "border-box" }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 4 }}>
          Qo'shimcha "ish" dasturlari (har birini alohida qatorga, masalan
          myide.exe)
        </label>
        <textarea
          value={workAppsText}
          onChange={(e) => setWorkAppsText(e.target.value)}
          rows={3}
          style={{ width: "100%", padding: 6, boxSizing: "border-box", fontFamily: "monospace" }}
        />
      </fieldset>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Tinch soatlar (quiet hours)</legend>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label>
            Boshlanishi{" "}
            <input
              type="number"
              min={-1}
              max={23}
              value={config.quiet_hours_start}
              onChange={(e) =>
                setConfig({ ...config, quiet_hours_start: Number(e.target.value) })
              }
              style={{ width: 60 }}
            />
          </label>
          <label>
            Tugashi{" "}
            <input
              type="number"
              min={-1}
              max={23}
              value={config.quiet_hours_end}
              onChange={(e) =>
                setConfig({ ...config, quiet_hours_end: Number(e.target.value) })
              }
              style={{ width: 60 }}
            />
          </label>
        </div>
        <div style={{ color: "#666", marginTop: 6 }}>-1 = o'chirilgan</div>
      </fieldset>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Ishga tushirish</legend>
        <label>
          <input
            type="checkbox"
            checked={config.autostart_enabled}
            onChange={(e) => setConfig({ ...config, autostart_enabled: e.target.checked })}
          />{" "}
          Purr'ni Windows bilan birga ishga tushirish
        </label>
      </fieldset>

      <fieldset style={{ marginBottom: 16 }}>
        <legend>Cloud AI (ixtiyoriy)</legend>
        <label style={{ display: "block", marginBottom: 6 }}>
          Claude API key ({cloudKeySet ? "saqlangan" : "kiritilmagan"})
        </label>
        <input
          type="password"
          value={cloudKeyInput}
          onChange={(e) => setCloudKeyInput(e.target.value)}
          placeholder="sk-ant-..."
          style={{ width: "100%", padding: 6, boxSizing: "border-box", marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={saveCloudKey}>Saqlash</button>
          <button onClick={removeCloudKey} disabled={!cloudKeySet}>
            O'chirish
          </button>
        </div>
      </fieldset>

      {status && <div style={{ marginBottom: 12, color: "#555" }}>{status}</div>}

      <button onClick={save} style={{ padding: "8px 20px", fontWeight: 600 }}>
        Barchasini saqlash
      </button>
    </div>
  );
}

export default Settings;
