# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start Rsbuild dev server + Electron (hot reload)
pnpm build        # Production bundle + package Electron app
pnpm test         # Run Vitest unit tests
pnpm knip         # Detect unused files/exports
```

TypeScript check (no emit):
```bash
npx tsc --noEmit
```

## Architecture Overview

**Biu** is a cross-platform Bilibili music/video player. Electron main process + React 19 renderer, built with Rsbuild.

```
electron/       Main process — IPC handlers, file system, Python subprocesses
src/            Renderer process — React 19, Zustand, TailwindCSS 4, HeroUI
shared/         Shared across both — ambient type declarations (no exports)
```

### IPC (Main ↔ Renderer)

- **Single source of truth for channel names:** `electron/ipc/channel.ts`
- **Preload bridge** (`electron/preload.ts`): exposes `window.electron` API via contextBridge
- **Handler registration** (`electron/ipc/index.ts`): all `ipcMain.handle()` calls registered at startup
- Renderer calls `window.electron.method()` → preload `ipcRenderer.invoke()` → main handler

The `ElectronAPI` interface lives in `shared/types/renderer.d.ts`. When adding a new IPC channel, add to `channel.ts`, implement the handler, and extend `ElectronAPI`.

### Renderer State (Zustand)

Stores live in `src/store/`. Key stores:

- **`play-list.ts`** — playback queue, current track (`PlayData`), play mode, volume/rate
- **`play-progress.ts`** — current playback time
- **`settings.ts`** — user preferences (persisted via electron-store)
- **`local-fav-items.ts`** — local favorites (persisted)
- **`modal/`** — one slice per modal (confirm, fav-select, full-screen-player, etc.)

Stores use `persist` middleware (electron-store backend) and `immer` for immutable updates. Access outside React via `useStore.getState()`.

### API Layer (Renderer)

`src/service/` contains 70+ Bilibili API wrappers using axios instances from `src/service/request/index.ts`:

- `apiRequest` — main Bilibili API (api.bilibili.com)
- `searchRequest`, `memberRequest`, `passportRequest`, `biliRequest` — domain-specific clients

All requests to protected endpoints go through a WBI signing interceptor (md5/sha256 `w-rid` header). Do not call `window.electron.http.get/post` from the renderer for Bilibili API — use the axios service layer instead. Main-process HTTP (for server-side fetches) uses `got` v14.

### Audio Playback

Videos use Bilibili DASH streams — video and audio are separate tracks. `src/service/web-interface-view.ts` fetches video metadata including `pages[]` for multi-page videos. Each page has a unique `cid` (globally unique on B站). For type=`mv` items, `getMVData(bvid)` is called from the play-list store to resolve audio URLs.

`PlayItem` is the input shape for `play()`; `PlayData` is the enriched shape stored in the queue. Key fields: `bvid`, `cid`, `type` (`mv` | `audio`), `source` (`local` | `online`).

### Local Favorites

`LocalFavItem` in `src/store/local-fav-items.ts` supports page-specific saves for multi-page videos: `rid = cid` (not `aid`) for page-specific entries; `cid`, `page`, `partTitle` fields are set. Whole-video saves keep `rid = aid`.

### Python Subprocesses

- `electron/ipc/find-python.ts` — shared `findPython()` utility
- `electron/ipc/shazam.ts` — song recognition (requires `shazamio`)
- `electron/ipc/api/aeneas-sync.ts` — lyrics time-axis sync (`pip install aeneas` + ffmpeg)

### Import Order (ESLint enforced)

**Renderer:** `react` → external packages → `@/` internal → `@shared/` → relative  
**Main process:** external (electron/got/etc.) → `node:` built-ins → relative internal

Violations are auto-fixed by ESLint's `perfectionist/sort-imports` rule.

### Path Aliases

- `@/` → `src/`
- `@shared/` → `shared/`

Types in `shared/types/*.d.ts` are global ambient declarations — no imports needed in renderer or main.
