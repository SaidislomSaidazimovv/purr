# Purr 🐱

A lazy, sarcastic cat that lives on your desktop. Built with Tauri v2 + Rust + React.

Purr walks around your screen, reacts when you click it, can be dragged around (with gravity), and falls asleep when you ignore it for too long — all while letting clicks pass through to whatever's underneath.

## Stack

- **Shell:** Tauri v2
- **Backend:** Rust
- **Frontend:** React + TypeScript + Vite

## Development

```bash
npm install
npm run tauri dev
```

## Status

Early development — core overlay mechanics (click-through, drag, walk/sleep FSM, tray icon) are working. Purr also now senses your foreground app, system idle time, and git commits, logs them to SQLite, and reacts with a simple mood that shifts its color and movement. Work has started on Purr actually speaking (rule-based lines in a chat bubble); local LLM chat and a pixel-art sprite are next.
