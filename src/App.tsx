import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

const PET_SIZE = 80;
const WALK_SPEED = 60; // px/second
const FALL_SPEED = 900; // px/second^2
const REAL_IDLE_SLEEP_SECONDS = 40 * 60; // system-wide idle this long -> sleep (Faza 2 gate)
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
  const reactionTimeout = useRef<number | null>(null);
  const systemIdleSeconds = useRef(0);

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
  // spot, fall asleep once the user has been away from the whole PC for
  // REAL_IDLE_SLEEP_SECONDS (not just away from the pet), or wake back up
  // once real activity resumes.
  useEffect(() => {
    const id = setInterval(() => {
      const idleSec = systemIdleSeconds.current;

      if (stateRef.current === "sleep") {
        if (idleSec < REAL_IDLE_SLEEP_SECONDS) {
          setState("idle");
          invoke("log_event", { kind: "sleep_end", idleSeconds: idleSec }).catch(() => {});
        }
        return;
      }

      if (stateRef.current === "idle") {
        if (idleSec >= REAL_IDLE_SLEEP_SECONDS) {
          setState("sleep");
          invoke("log_event", { kind: "sleep_start", idleSeconds: idleSec }).catch(() => {});
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
  }, [state, triggerReaction]);

  // TEMPORARY (Faza 2 spike): poll and display what the tracker sees, so we
  // can visually confirm it's correct before wiring it into the brain.
  const [debugSnapshot, setDebugSnapshot] = useState<{
    process_name: string | null;
    category: string;
    idle_seconds: number;
  } | null>(null);

  const lastLoggedCategory = useRef<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      invoke("get_activity_snapshot")
        .then((snap) => {
          const s = snap as typeof debugSnapshot;
          setDebugSnapshot(s);
          if (s) {
            systemIdleSeconds.current = s.idle_seconds;
            if (s.category !== lastLoggedCategory.current) {
              lastLoggedCategory.current = s.category;
              invoke("log_event", {
                kind: "foreground",
                category: s.category,
                processName: s.process_name,
              }).catch(() => {});
            }
          }
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(id);
  }, []);

  // TEMPORARY (Faza 2 spike): poll our own repo for new commits; react with
  // the same click-bounce animation when one is detected. This is the real
  // Faza 2 gate behavior ("commit qilsangiz pet sakraydi"), just watching a
  // hardcoded path for now — repo picker comes later in Settings.
  const REPO_PATH = "F:/Main and Private/PetApp";
  const [commitCount, setCommitCount] = useState(0);
  const [gitError, setGitError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      invoke("check_new_commit", { repoPath: REPO_PATH })
        .then((hit) => {
          setGitError(null);
          if (hit) {
            setCommitCount((c) => c + 1);
            if (stateRef.current === "sleep") setState("idle");
            triggerReaction();
            invoke("log_event", { kind: "commit" }).catch(() => {});
          }
        })
        .catch((e) => setGitError(String(e)));
    }, 3000);
    return () => clearInterval(id);
  }, [triggerReaction]);

  // TEMPORARY (Faza 2 spike): poll SQLite row count so we can visually
  // confirm log_event writes are actually landing in the database.
  const [dbEventCount, setDbEventCount] = useState<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      invoke("get_event_count")
        .then((n) => setDbEventCount(n as number))
        .catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const asleep = state === "sleep";

  return (
    <>
    {debugSnapshot && (
      <div
        style={{
          position: "absolute",
          left: 8,
          top: 8,
          padding: "6px 10px",
          background: "rgba(0,0,0,0.7)",
          color: "#0f0",
          fontFamily: "monospace",
          fontSize: 12,
          borderRadius: 6,
          pointerEvents: "none",
        }}
      >
        app: {debugSnapshot.process_name ?? "?"} | kategoriya: {debugSnapshot.category} | idle:{" "}
        {debugSnapshot.idle_seconds}s | commits: {commitCount}
        <br />
        pet pos: ({Math.round(pos.x)}, {Math.round(pos.y)}) | state: {state} | win: {window.innerWidth}x
        {window.innerHeight}
        <br />
        db events: {dbEventCount ?? "?"}
        {gitError && <div style={{ color: "#f55" }}>git xato: {gitError}</div>}
      </div>
    )}
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
    </>
  );
}

export default App;
