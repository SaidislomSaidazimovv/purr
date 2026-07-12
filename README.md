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

Early development — core overlay mechanics (click-through, drag, walk/sleep FSM, tray icon) are working. Pixel-art sprite and productivity-aware AI chat are next.
