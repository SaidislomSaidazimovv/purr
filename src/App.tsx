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
const BUBBLE_MS = 4500; // how long a spoken line stays visible
const LONG_FOCUS_MS = 2 * 60 * 60 * 1000; // continuous "code" time before the pet comments

// Brain: a simple mood score nudged by tracked events, decaying back to
// neutral over time. Mood in turn affects how the pet looks/moves — the
// Faza 2 "kayfiyat animatsiyaga ta'sir qiladi" gate. Faza 3's rule engine
// will read the same signals for actual dialogue.
const MOOD_CLAMP = 100;
const MOOD_COMMIT_BOOST = 25;
const MOOD_CODE_BOOST = 5;
const MOOD_GAME_PENALTY = 10;
const MOOD_DECAY = 0.97; // multiplied in every 2.5s FSM tick, pulls score toward 0
const MOOD_HAPPY_THRESHOLD = 30;
const MOOD_GRUMPY_THRESHOLD = -30;

type PetState = "idle" | "walk" | "drag" | "fall" | "sleep";
type Mood = "happy" | "neutral" | "grumpy";

// A simple flat-design sitting cat, standing in for a real pixel-art sprite
// until Faza 4's art pass. Fur color is passed in so the existing
// state/mood color-coding (drag/asleep/happy/grumpy) keeps working exactly
// as before — this only changes the shape, not the signal.
function PetSprite({ color, eyesClosed }: { color: string; eyesClosed: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%">
      <path
        d="M 14 58 Q 10 40 14 30 Q 8 22 12 14 Q 20 4 26 14 Q 32 8 38 14 Q 44 4 52 14 Q 56 22 50 30 Q 54 40 50 58 Z"
        fill={color}
      />
      <ellipse cx="32" cy="48" rx="11" ry="9" fill="#fff2df" opacity={0.85} />
      {eyesClosed ? (
        <>
          <path d="M 22 27 Q 26 30 30 27" stroke="#1a1a1a" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M 34 27 Q 38 30 42 27" stroke="#1a1a1a" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <ellipse cx="25" cy="27" rx="2.4" ry="3" fill="#1a1a1a" />
          <ellipse cx="39" cy="27" rx="2.4" ry="3" fill="#1a1a1a" />
        </>
      )}
      <path d="M 30 32 L 34 32 L 32 35 Z" fill="#ff9fb0" />
      <path
        d="M 32 35 Q 29 39 26 36 M 32 35 Q 35 39 38 36"
        stroke="#1a1a1a"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="22" cy="56" rx="5" ry="4" fill="#fff2df" opacity={0.85} />
      <ellipse cx="42" cy="56" rx="5" ry="4" fill="#fff2df" opacity={0.85} />
    </svg>
  );
}

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

  // Brain: mood score in [-100, 100], nudged by events, decaying to 0.
  const [moodScore, setMoodScore] = useState(0);
  const moodRef = useRef<Mood>("neutral");
  const mood: Mood =
    moodScore >= MOOD_HAPPY_THRESHOLD
      ? "happy"
      : moodScore <= MOOD_GRUMPY_THRESHOLD
        ? "grumpy"
        : "neutral";
  moodRef.current = mood;

  const bumpMood = useCallback((delta: number) => {
    setMoodScore((m) => Math.max(-MOOD_CLAMP, Math.min(MOOD_CLAMP, m + delta)));
  }, []);

  // Faza 3: rule engine — asks Rust for a line matching the trigger and
  // shows it in a speech bubble for a few seconds.
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const bubbleTimeout = useRef<number | null>(null);

  const sayPhrase = useCallback((trigger: string) => {
    invoke("get_phrase", { trigger })
      .then((phrase) => {
        if (!phrase) return;
        setBubbleText(phrase as string);
        if (bubbleTimeout.current) window.clearTimeout(bubbleTimeout.current);
        bubbleTimeout.current = window.setTimeout(() => setBubbleText(null), BUBBLE_MS);
      })
      .catch(() => {});
  }, []);

  // Gate: pet greets you shortly after the app starts.
  useEffect(() => {
    const t = window.setTimeout(() => sayPhrase("startup"), 800);
    return () => window.clearTimeout(t);
  }, [sayPhrase]);

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

      setMoodScore((m) => (Math.abs(m) < 0.5 ? 0 : m * MOOD_DECAY));

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
          sayPhrase("long_idle");
          return;
        }
        // A happy pet wanders more often; a grumpy (lazy, sulking) one stays put.
        const wanderChance =
          moodRef.current === "happy" ? 0.65 : moodRef.current === "grumpy" ? 0.25 : 0.5;
        if (Math.random() > wanderChance) return;
        const groundWidth = window.innerWidth - PET_SIZE;
        const delta = (Math.random() - 0.5) * 300;
        const target = Math.max(0, Math.min(groundWidth, posRef.current.x + delta));
        walkTarget.current = target;
        setState("walk");
      }
    }, 2500);
    return () => clearInterval(id);
  }, [sayPhrase]);

  // Faza 3 Gate: the pet speaks entirely on its own right after midnight,
  // once per day — no click, commit, or other interaction required.
  const lastMidnightDateRef = useRef<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        const today = now.toDateString();
        if (lastMidnightDateRef.current !== today) {
          lastMidnightDateRef.current = today;
          sayPhrase("midnight");
        }
      }
    }, 20000);
    return () => clearInterval(id);
  }, [sayPhrase]);

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
          const speedMul = moodRef.current === "happy" ? 1.5 : moodRef.current === "grumpy" ? 0.6 : 1;
          const step = Math.sign(diff) * WALK_SPEED * speedMul * dt;
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
      const maxX = window.innerWidth - PET_SIZE;
      const maxY = window.innerHeight - PET_SIZE;
      setPos({
        x: Math.max(0, Math.min(maxX, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(maxY, e.clientY - dragOffset.current.y)),
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
      if (wasClick) {
        triggerReaction();
        sayPhrase("click");
      }

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
  }, [state, triggerReaction, sayPhrase]);

  // TEMPORARY (Faza 2 spike): poll and display what the tracker sees, so we
  // can visually confirm it's correct before wiring it into the brain.
  const [debugSnapshot, setDebugSnapshot] = useState<{
    process_name: string | null;
    category: string;
    idle_seconds: number;
  } | null>(null);

  const lastLoggedCategory = useRef<string | null>(null);

  // Tracks how long the "code" category has been continuously active, for
  // the long_focus trigger — reset whenever the category changes away from
  // "code", and only fires once per continuous stretch.
  const codeFocusStartRef = useRef<number | null>(null);
  const longFocusNotifiedRef = useRef(false);

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
              if (s.category === "code") bumpMood(MOOD_CODE_BOOST);
              else if (s.category === "game") bumpMood(-MOOD_GAME_PENALTY);

              if (s.category === "code") {
                codeFocusStartRef.current = Date.now();
                longFocusNotifiedRef.current = false;
              } else {
                codeFocusStartRef.current = null;
                longFocusNotifiedRef.current = false;
              }
            }

            if (
              s.category === "code" &&
              codeFocusStartRef.current !== null &&
              !longFocusNotifiedRef.current &&
              Date.now() - codeFocusStartRef.current >= LONG_FOCUS_MS
            ) {
              longFocusNotifiedRef.current = true;
              sayPhrase("long_focus");
            }
          }
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(id);
  }, [bumpMood, sayPhrase]);

  // Repo watched for commits — read from config.json (app data dir), created
  // with a sensible default on first run. Editing that file changes which
  // repo the pet reacts to; a real picker UI comes later in Faza 4 Settings.
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [commitCount, setCommitCount] = useState(0);
  const [gitError, setGitError] = useState<string | null>(null);

  useEffect(() => {
    invoke("get_repo_path")
      .then((p) => setRepoPath(p as string))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!repoPath) return;
    const id = setInterval(() => {
      invoke("check_new_commit", { repoPath })
        .then((hit) => {
          setGitError(null);
          if (hit) {
            setCommitCount((c) => c + 1);
            if (stateRef.current === "sleep") setState("idle");
            triggerReaction();
            bumpMood(MOOD_COMMIT_BOOST);
            sayPhrase("commit");
            invoke("log_event", { kind: "commit" }).catch(() => {});
          }
        })
        .catch((e) => setGitError(String(e)));
    }, 3000);
    return () => clearInterval(id);
  }, [repoPath, triggerReaction, bumpMood, sayPhrase]);

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

  // Faza 3: RAM status, checked before starting the (heavy) local LLM
  // sidecar — this machine is frequently under 1GB free.
  const [memStatus, setMemStatus] = useState<{
    total_mb: number;
    free_mb: number;
    free_percent: number;
  } | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      invoke("get_memory_status")
        .then((m) => setMemStatus(m as typeof memStatus))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // LLM sidecar is started on demand (from the chat input, Faza 3 next
  // step) rather than on every launch — this machine can't always spare
  // the RAM. This just polls status for the debug overlay.
  const [llmRunning, setLlmRunning] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      invoke("llm_status")
        .then((s) => setLlmRunning(s as boolean))
        .catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const asleep = state === "sleep";
  const petColor =
    state === "drag"
      ? "#ff5555"
      : asleep
        ? "#883333"
        : mood === "happy"
          ? "#ff8a3d"
          : mood === "grumpy"
            ? "#7a4040"
            : "#e6482e";

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
        <br />
        mood: {mood} ({Math.round(moodScore)})
        <br />
        repo: {repoPath ?? "yuklanmoqda..."}
        <br />
        ram: {memStatus ? `${memStatus.free_mb} / ${memStatus.total_mb} MB (${memStatus.free_percent.toFixed(1)}%)` : "?"}
        <br />
        llm: {llmRunning ? "ishlayapti" : "to'xtatilgan"}
        {gitError && <div style={{ color: "#f55" }}>git xato: {gitError}</div>}
      </div>
    )}
    {bubbleText && (
      <div
        style={{
          position: "absolute",
          left: pos.x + PET_SIZE / 2,
          top: pos.y - 14,
          transform: "translate(-50%, -100%)",
          maxWidth: 220,
          background: "#fff",
          color: "#222",
          padding: "8px 12px",
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.3,
          fontFamily: "sans-serif",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          pointerEvents: "none",
        }}
      >
        {bubbleText}
        <div
          style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderTop: "6px solid #fff",
          }}
        />
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
        cursor: state === "drag" ? "grabbing" : "grab",
        opacity: asleep ? 0.6 : 1,
        transform: reacting ? "scale(1.15)" : "scale(1)",
        transition: "transform 120ms ease-out, opacity 400ms ease, filter 200ms ease",
      }}
    >
      <PetSprite color={petColor} eyesClosed={asleep} />
    </div>
    </>
  );
}

export default App;
