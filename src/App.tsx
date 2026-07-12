import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

const PET_SIZE = 80;
const WALK_SPEED = 60; // px/second
const FALL_SPEED = 900; // px/second^2
const SLEEP_AFTER_MS = 15000; // idle this long with no interaction -> sleep
const CLICK_MAX_MOVE = 6; // px — below this, mouseup counts as a "click" not a drag
const CLICK_MAX_MS = 300; // below this duration, same
const REACTION_MS = 400;

type PetState = "idle" | "walk" | "drag" | "fall" | "sleep";

function App() {
  const [pos, setPos] = useState({ x: 200, y: 200 });
  const [state, setState] = useState<PetState>("idle");
  const [reacting, setReacting] = useState(false);

  const posRef = useRef(pos);
  posRef.current = pos;
  const stateRef = useRef(state);
  stateRef.current = state;

  const windowOffset = useRef({ x: 0, y: 0 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0, time: 0 });
  const walkTarget = useRef<number | null>(null);
  const fallVelocity = useRef(0);
  const lastActivity = useRef(Date.now());
  const reactionTimeout = useRef<number | null>(null);

  const markActivity = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  // Physical screen bounds of the pet, reported to Rust for click-through hit-testing.
  const reportBounds = useCallback((x: number, y: number) => {
    const scale = window.devicePixelRatio || 1;
    invoke("update_pet_bounds", {
      x: windowOffset.current.x + x * scale,
      y: windowOffset.current.y + y * scale,
      width: PET_SIZE * scale,
      height: PET_SIZE * scale,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    getCurrentWindow()
      .outerPosition()
      .then((p) => {
        windowOffset.current = { x: p.x, y: p.y };
        reportBounds(posRef.current.x, posRef.current.y);
      })
      .catch(() => {});
  }, [reportBounds]);

  useEffect(() => {
    reportBounds(pos.x, pos.y);
  }, [pos, reportBounds]);

  // Idle/walk/sleep FSM: every couple of seconds, maybe wander to a nearby
  // spot, or fall asleep after a long stretch with no interaction.
  useEffect(() => {
    const id = setInterval(() => {
      if (stateRef.current === "idle") {
        if (Date.now() - lastActivity.current > SLEEP_AFTER_MS) {
          setState("sleep");
          return;
        }
        if (Math.random() < 0.5) return;
        const groundWidth = window.innerWidth - PET_SIZE;
        const delta = (Math.random() - 0.5) * 300;
        const target = Math.max(0, Math.min(groundWidth, posRef.current.x + delta));
        walkTarget.current = target;
        setState("walk");
      }
    }, 2500);
    return () => clearInterval(id);
  }, []);

  // Animation loop: drives walking and falling.
  useEffect(() => {
    let raf: number;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (stateRef.current === "walk" && walkTarget.current !== null) {
        const target = walkTarget.current;
        const current = posRef.current.x;
        const diff = target - current;
        if (Math.abs(diff) < 2) {
          walkTarget.current = null;
          setState("idle");
        } else {
          const step = Math.sign(diff) * WALK_SPEED * dt;
          setPos((p) => ({ ...p, x: current + step }));
        }
      } else if (stateRef.current === "fall") {
        const groundY = window.innerHeight - PET_SIZE;
        fallVelocity.current += FALL_SPEED * dt;
        setPos((p) => {
          const nextY = Math.min(groundY, p.y + fallVelocity.current * dt);
          if (nextY >= groundY) {
            fallVelocity.current = 0;
            setState("idle");
          }
          return { ...p, y: nextY };
        });
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const triggerReaction = useCallback(() => {
    setReacting(true);
    if (reactionTimeout.current) window.clearTimeout(reactionTimeout.current);
    reactionTimeout.current = window.setTimeout(() => setReacting(false), REACTION_MS);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    markActivity();
    dragOffset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
    dragStart.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    walkTarget.current = null;
    setState("drag");
    invoke("set_drag_active", { active: true }).catch(() => {});
  };

  useEffect(() => {
    if (state !== "drag") return;

    const onMove = (e: MouseEvent) => {
      setPos({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const onUp = (e: MouseEvent) => {
      invoke("set_drag_active", { active: false }).catch(() => {});
      markActivity();

      const movedDist = Math.hypot(
        e.clientX - dragStart.current.x,
        e.clientY - dragStart.current.y,
      );
      const elapsed = Date.now() - dragStart.current.time;
      const wasClick = movedDist < CLICK_MAX_MOVE && elapsed < CLICK_MAX_MS;
      if (wasClick) triggerReaction();

      const groundY = window.innerHeight - PET_SIZE;
      fallVelocity.current = 0;
      setState(posRef.current.y >= groundY ? "idle" : "fall");
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [state, markActivity, triggerReaction]);

  const asleep = state === "sleep";

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: PET_SIZE,
        height: PET_SIZE,
        background: state === "drag" ? "#ff5555" : asleep ? "#883333" : "red",
        borderRadius: 8,
        cursor: state === "drag" ? "grabbing" : "grab",
        opacity: asleep ? 0.6 : 1,
        transform: reacting ? "scale(1.15)" : "scale(1)",
        transition: "transform 120ms ease-out, opacity 400ms ease, background 200ms ease",
      }}
    />
  );
}

export default App;
