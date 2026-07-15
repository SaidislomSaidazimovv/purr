import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import Settings from "./Settings";
import Onboarding from "./Onboarding";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// Same webview bundle serves the pet overlay ("main") and the real decorated
// Settings/Onboarding windows (see window.rs) — pick which UI to render
// based on the window label.
async function bootstrap() {
  const label = getCurrentWindow().label;
  if (label === "settings") {
    root.render(
      <React.StrictMode>
        <Settings />
      </React.StrictMode>,
    );
    return;
  }
  if (label === "onboarding") {
    root.render(
      <React.StrictMode>
        <Onboarding />
      </React.StrictMode>,
    );
    return;
  }

  // Pet size/speed are read once here rather than hot-reloaded inside App,
  // so the physics loop never has to react to them changing mid-session.
  let petSize: number | undefined;
  let walkSpeed: number | undefined;
  try {
    const cfg = await invoke<{ pet_size: number; pet_speed: number }>("get_settings");
    petSize = cfg.pet_size;
    walkSpeed = cfg.pet_speed;
  } catch {
    // Fall through to App's own defaults.
  }

  root.render(
    <React.StrictMode>
      <App initialPetSize={petSize} initialWalkSpeed={walkSpeed} />
    </React.StrictMode>,
  );
}

bootstrap();
