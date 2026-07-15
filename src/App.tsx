import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";

const DEFAULT_PET_SIZE = 80;
const DEFAULT_WALK_SPEED = 60; // px/second
const FALL_SPEED = 900; // px/second^2
const REAL_IDLE_SLEEP_SECONDS = 40 * 60; // system-wide idle this long -> sleep (Faza 2 gate)
const CLICK_MAX_MOVE = 6; // px — below this, mouseup counts as a "click" not a drag
const CLICK_MAX_MS = 300; // below this duration, same
const REACTION_MS = 400;
const BUBBLE_MS = 4500; // how long a spoken line stays visible
const CHAT_BUBBLE_MS = 12000; // LLM replies are longer, give them more time on screen
const LONG_FOCUS_MS = 2 * 60 * 60 * 1000; // continuous "code" time before the pet comments
const DOUBLE_CLICK_MS = 400; // second click within this window opens chat instead of reacting

// English, not Uzbek — this small model's Uzbek output is rough (expected
// for a low-resource language on a 1.5B model), but it writes natural,
// expressive English. The rule-engine phrases stay Uzbek since those are
// hand-written, not generated.
const CHAT_SYSTEM_PROMPT =
  "You are Purr, a lazy and sarcastic cat who lives on someone's desktop. " +
  "Reply in English, in 1-2 short sentences, lowercase, no period at the end, " +
  "in a casual, natural, emotionally expressive way — witty and a little sarcastic, but never mean.";

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

// CC0 sprite frames (public/sprites/cat/) — see ATTRIBUTION.txt there.
// happy/grumpy play while idle with that mood; drag and sleep still reuse
// the idle pose (sleep freezes on frame 1 and dims via CSS filter instead
// of animating, to read as "still" rather than "active").
const SPRITE_FRAME_COUNTS = { idle: 10, walk: 10, fall: 8, happy: 8, grumpy: 10 } as const;
type SpriteAnim = keyof typeof SPRITE_FRAME_COUNTS;
const SPRITE_FRAME_MS = 120;

function PetSprite({ anim, still, filterCss }: { anim: SpriteAnim; still: boolean; filterCss: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (still) return;
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % SPRITE_FRAME_COUNTS[anim]);
    }, SPRITE_FRAME_MS);
    return () => clearInterval(id);
  }, [anim, still]);

  const frameNum = (still ? 0 : frame % SPRITE_FRAME_COUNTS[anim]) + 1;
  return (
    <img
      src={`/sprites/cat/${anim}/${frameNum}.png`}
      draggable={false}
      style={{ width: "100%", height: "100%", objectFit: "contain", filter: filterCss }}
    />
  );
}

function App({
  initialPetSize = DEFAULT_PET_SIZE,
  initialWalkSpeed = DEFAULT_WALK_SPEED,
}: {
  initialPetSize?: number;
  initialWalkSpeed?: number;
}) {
  // Settings-window values are read once at startup (see main.tsx) rather
  // than hot-reloaded — changing them takes effect on next launch, which
  // avoids threading live-updating size/speed through the physics loop's
  // closures below.
  const PET_SIZE = initialPetSize;
  const WALK_SPEED = initialWalkSpeed;
  // Spawn resting on the ground, not floating — floating meant the first
  // click always triggered the fall/settle check unnecessarily.
  const [pos, setPos] = useState(() => ({ x: 200, y: window.innerHeight - PET_SIZE }));
  const [state, setState] = useState<PetState>("idle");
  const [facing, setFacing] = useState<"left" | "right">("right");
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

  const sayRaw = useCallback((text: string, ms: number) => {
    setBubbleText(text);
    if (bubbleTimeout.current) window.clearTimeout(bubbleTimeout.current);
    bubbleTimeout.current = window.setTimeout(() => setBubbleText(null), ms);
  }, []);

  // Ambient/triggered speech only — direct chat replies (sendChatMessage)
  // don't go through this, so quiet hours mute unsolicited commentary
  // without ignoring something the user actually typed to the pet.
  const sayPhrase = useCallback(
    (trigger: string) => {
      invoke("is_quiet_hours")
        .then((quiet) => {
          if (quiet) return;
          return invoke("get_phrase", { trigger }).then((phrase) => {
            if (phrase) sayRaw(phrase as string, BUBBLE_MS);
          });
        })
        .catch(() => {});
    },
    [sayRaw],
  );

  // Gate: pet greets you shortly after the app starts.
  useEffect(() => {
    const t = window.setTimeout(() => sayPhrase("startup"), 800);
    return () => window.clearTimeout(t);
  }, [sayPhrase]);

  // Faza 4 B6: silent auto-update check, a while after startup so it never
  // competes with the greeting bubble. No release feed yet during
  // development — a failed/empty check is expected and stays silent.
  useEffect(() => {
    const t = window.setTimeout(() => {
      checkForUpdate()
        .then((update) => {
          if (!update) return;
          sayRaw("yangilanish bor, o'rnatyapman...", CHAT_BUBBLE_MS);
          return update.downloadAndInstall().then(() => relaunch());
        })
        .catch(() => {
          // No feed reachable / no releases yet — stay quiet, this isn't
          // something the user needs to see or act on.
        });
    }, 5000);
    return () => window.clearTimeout(t);
  }, [sayRaw]);

  // Faza 3: chat — double-click opens a text input, sent to the local LLM.
  // The window is made fully click-through-disabled (like during drag)
  // while the input is open, since only the pet's bounds are normally
  // tracked for hit-testing.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const lastClickTimeRef = useRef(0);

  const openChat = useCallback(() => {
    setChatOpen(true);
    invoke("set_drag_active", { active: true }).catch(() => {});
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    invoke("set_drag_active", { active: false }).catch(() => {});
  }, []);

  // While chat is open the whole window is fully interactive (not just the
  // pet's bounds), so a click that lands outside the input can steal focus
  // from it — leaving Escape's onKeyDown on the input unreachable and the
  // chat stuck open. Listen at the window level instead so Escape always
  // works regardless of what currently has focus.
  useEffect(() => {
    if (!chatOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeChat();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen, closeChat]);

  // Spawning the sidecar only means the OS process exists — llama-server
  // still takes a couple seconds to load the model before it's actually
  // listening. Poll /health until it responds (or give up) instead of
  // firing the chat request immediately and getting a race-condition dud.
  const waitForLlmReady = useCallback((port: number, timeoutMs: number) => {
    const start = Date.now();
    const attempt = (): Promise<void> =>
      fetch(`http://127.0.0.1:${port}/health`)
        .then((res) => {
          if (!res.ok) throw new Error("not ready");
        })
        .catch((e) => {
          if (Date.now() - start > timeoutMs) throw e;
          return new Promise((resolve) => window.setTimeout(resolve, 300)).then(attempt);
        });
    return attempt();
  }, []);

  // repoPath feeds the git-commit watcher below; cloudKeySet decides
  // whether chat uses the user's own cloud AI key or the local model.
  // Both are configured from the real Settings window (Settings.tsx) now —
  // see window.rs::open_settings_window.
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [cloudKeySet, setCloudKeySet] = useState(false);

  const refreshCloudKeyStatus = useCallback(() => {
    invoke("has_cloud_api_key")
      .then((set) => setCloudKeySet(Boolean(set)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCloudKeyStatus();
  }, [refreshCloudKeyStatus]);

  const sendChatMessage = useCallback(
    (message: string) => {
      const trimmed = message.trim();
      setChatText("");
      closeChat();
      if (!trimmed) return;

      setChatBusy(true);
      sayRaw("thinking...", 30000);

      // Cloud AI (user's own key, set in Advanced settings) takes priority
      // over the local model when configured — better reply quality, no
      // RAM cost. Falls through to local llama-server otherwise.
      if (cloudKeySet) {
        invoke("send_cloud_chat", { message: trimmed })
          .then((reply) => {
            sayRaw((reply as string) || "no answer came through", CHAT_BUBBLE_MS);
            invoke("log_event", { kind: "chat" }).catch(() => {});
          })
          .catch((e) => sayRaw(`error: ${String(e)}`, CHAT_BUBBLE_MS))
          .finally(() => setChatBusy(false));
        return;
      }

      let llmPort = 0;
      invoke("start_llm")
        .then(() => invoke("get_llm_port"))
        .then((port) => {
          llmPort = port as number;
          return waitForLlmReady(llmPort, 15000);
        })
        .then(() =>
          fetch(`http://127.0.0.1:${llmPort}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [
                { role: "system", content: CHAT_SYSTEM_PROMPT },
                { role: "user", content: trimmed },
              ],
              max_tokens: 120,
              temperature: 0.8,
            }),
          }),
        )
        .then((res) => res.json())
        .then((data) => {
          const reply = data?.choices?.[0]?.message?.content?.trim();
          sayRaw(reply || "no answer came through", CHAT_BUBBLE_MS);
          invoke("log_event", { kind: "chat" }).catch(() => {});
        })
        .catch((e) => sayRaw(`error: ${String(e)}`, CHAT_BUBBLE_MS))
        .finally(() => setChatBusy(false));
    },
    [closeChat, sayRaw, waitForLlmReady, cloudKeySet],
  );

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
        setFacing(delta >= 0 ? "right" : "left");
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
      if (e.movementX > 0) setFacing("right");
      else if (e.movementX < 0) setFacing("left");
      setPos({
        x: Math.max(0, Math.min(maxX, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(maxY, e.clientY - dragOffset.current.y)),
      });
    };
    const onUp = (e: MouseEvent) => {
      const movedDist = Math.hypot(
        e.clientX - dragStart.current.x,
        e.clientY - dragStart.current.y,
      );
      const elapsed = Date.now() - dragStart.current.time;
      const wasClick = movedDist < CLICK_MAX_MOVE && elapsed < CLICK_MAX_MS;

      let openingChat = false;
      if (wasClick) {
        const now = Date.now();
        if (now - lastClickTimeRef.current < DOUBLE_CLICK_MS) {
          lastClickTimeRef.current = 0;
          openingChat = true;
          openChat();
        } else {
          lastClickTimeRef.current = now;
          triggerReaction();
          sayPhrase("click");
        }
      }
      if (!openingChat) {
        invoke("set_drag_active", { active: false }).catch(() => {});
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
  }, [state, triggerReaction, sayPhrase, openChat]);

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
  // with a sensible default on first run. Changeable via the Advanced
  // settings panel (repoPath state declared earlier, near that panel).
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
  // Standing still with a mood plays a real distinct pose (Jump = happy/
  // laughing, Hurt = upset/crying — same CC0 pack, previously unused
  // frames) instead of just recoloring idle. Walking still uses the CSS
  // filter below since there's no dedicated walk-while-moody art.
  const spriteAnim: SpriteAnim =
    state === "walk"
      ? "walk"
      : state === "fall"
        ? "fall"
        : state === "idle" && mood === "happy"
          ? "happy"
          : state === "idle" && mood === "grumpy"
            ? "grumpy"
            : "idle";
  const spriteFilter =
    state === "drag"
      ? "brightness(1.15)"
      : asleep
        ? "brightness(0.6) saturate(0.7)"
        : spriteAnim === "happy" || spriteAnim === "grumpy"
          ? "none"
          : mood === "happy"
            ? "brightness(1.1) saturate(1.3)"
            : mood === "grumpy"
              ? "brightness(0.75) saturate(0.6)"
              : "none";

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
    {chatOpen && (
      <div
        onMouseDown={closeChat}
        style={{
          position: "fixed",
          inset: 0,
        }}
      />
    )}
    {chatOpen && (
      <input
        autoFocus
        disabled={chatBusy}
        value={chatText}
        onChange={(e) => setChatText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") sendChatMessage(chatText);
          if (e.key === "Escape") closeChat();
        }}
        placeholder="talk to your pet..."
        style={{
          position: "absolute",
          left: pos.x + PET_SIZE / 2,
          top: pos.y - 14,
          transform: "translate(-50%, -100%)",
          width: 200,
          padding: "8px 12px",
          borderRadius: 12,
          border: "none",
          fontSize: 13,
          fontFamily: "sans-serif",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}
      />
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
        transform: `${facing === "left" ? "scaleX(-1) " : ""}${reacting ? "scale(1.15)" : "scale(1)"}`,
        transition: "transform 120ms ease-out, opacity 400ms ease, filter 200ms ease",
      }}
    >
      <PetSprite anim={spriteAnim} still={asleep} filterCss={spriteFilter} />
    </div>
    </>
  );
}

export default App;
