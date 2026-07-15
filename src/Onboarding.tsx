import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

// First-run only — shown once from lib.rs::run().setup() when
// config.first_run_complete is still false, then never again (see
// window.rs::show_onboarding_window). Deliberately a single static panel,
// not a multi-step wizard: the model ships bundled with the app, so there's
// nothing to configure here, just a few lines explaining how the pet works.
function Onboarding() {
  const [closing, setClosing] = useState(false);

  const finish = useCallback(() => {
    setClosing(true);
    invoke("complete_onboarding")
      .catch(() => {})
      .finally(() => {
        getCurrentWindow().hide();
      });
  }, []);

  return (
    <div
      style={{
        padding: 28,
        fontFamily: "sans-serif",
        color: "#222",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <img
        src="/sprites/cat/idle/1.png"
        alt="Purr"
        style={{ width: 96, height: 96, imageRendering: "pixelated", alignSelf: "center" }}
      />
      <h2 style={{ textAlign: "center", marginTop: 12 }}>Purr'ga xush kelibsiz!</h2>

      <ul style={{ lineHeight: 1.8, fontSize: 14, paddingLeft: 20 }}>
        <li>Purr — ekraningizda yashaydigan, sizni kuzatib boradigan mushuk.</li>
        <li>Uni bosing yoki suday olasiz — sizga reaksiya beradi.</li>
        <li>Ustiga <b>ikki marta bosing</b> — u bilan yozishib gaplashishingiz mumkin.</li>
        <li>Kod yozsangiz, commit qilsangiz — kayfiyati o'zgaradi.</li>
        <li>Sozlamalar (o'lcham, tezlik, tinch soatlar) — tray ikonkasidan.</li>
      </ul>

      <div style={{ flex: 1 }} />

      <button
        onClick={finish}
        disabled={closing}
        style={{
          padding: "10px 0",
          fontWeight: 600,
          fontSize: 14,
          borderRadius: 6,
          border: "none",
          background: "#222",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Boshladik!
      </button>
    </div>
  );
}

export default Onboarding;
