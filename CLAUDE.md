# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Biu — Bilibili-API-based cross-platform music player. Electron (desktop) + Capacitor (Android). React 19 + Rsbuild for the renderer; same renderer bundle ships to both platforms. License is PolyForm Noncommercial 1.0.0.

Package manager is **pnpm 10.24.0**, Node **22.17.1** (enforced by `engines`).

## Commands

| Task | Command |
|---|---|
| Dev (Electron) | `pnpm dev` |
| Dev (Android renderer only) | `pnpm dev:android` (sets `BIU_TARGET=android`, skips Electron compile) |
| Production build (Electron, full installer) | `pnpm build` |
| Sync built renderer into Android project | `pnpm build:android` |
| Open Android Studio | `pnpm open:android` |
| All tests | `pnpm test` |
| Single test | `pnpm test play-list.test.ts` (vitest pattern match) |
| Dead-code check | `pnpm knip` |
| Tagged release (auto changelog + push) | `pnpm release` / `pnpm release:beta` / `pnpm release:alpha` |

### How `pnpm dev` actually works
This is non-obvious — there is no separate "build main process" step. The chain:
1. `rsbuild dev` starts the renderer dev server on port **5678** (`writeToDisk: true` so Electron can `file://` load).
2. The custom `pluginElectron` (`plugins/rsbuild-plugin-electron.ts`) hooks `onAfterDevCompile`. **Skipped when `BIU_TARGET=android`.**
3. On first compile it runs Rollup (`plugins/electron-config-build.ts`) to bundle `electron/main.ts` → `.electron/main.mjs` (ESM) and `electron/preload.ts` → `.electron/preload.cjs` (CJS).
4. `plugins/electron-dev.ts` then `spawn`s Electron pointing at `.electron/main.mjs`, and a chokidar watcher restarts it on any change under `electron/`.

### How `pnpm build` actually works
Same plugin, different hooks: `onBeforeBuild` compiles the main/preload bundles, then Rsbuild builds the renderer to `dist/web/`, then `onAfterBuild` invokes electron-builder. **electron-builder config is hard-coded inside `plugins/electron-build.ts`** (no `electron-builder.json`). Output: `dist/artifacts/`.

### Windows first-time setup
**Run `node dev_tools/setup-win.js` instead of `pnpm install`** on a fresh Windows box. It rewrites Git protocol (avoids SSH), configures pnpm mirrors, and pre-fetches Electron binaries. Idempotent — re-runnable.

## Architecture

### Three processes, one renderer bundle
- **Electron main** (`electron/`) — IPC handlers, native APIs, window management, downloads.
- **Renderer** (`src/`) — React 19 + Zustand + TailwindCSS 4 + HeroUI. **One single bundle** is loaded by 3 windows (main, mini-player, desktop-lyrics) and by Capacitor on Android. Windows differ only by hash route (`/`, `#mini-player`, `#desktop-lyrics`).
- **Android (Capacitor)** — wraps the same `dist/web/` renderer in a WebView.

### Platform abstraction (the linchpin)
At runtime, `src/platform/detect.ts` decides `isElectron = navigator.userAgent.includes("Electron")`; everything else in the platform layer flows from this:
- `src/platform/index.ts` exports a single `platform` object that lazily picks `electron.ts` or `android.ts` (the Android branch dynamically imports `http-android` so Electron builds don't pull in `@capacitor/core`).
- `src/platform/electron.ts` is a thin pass-through to `window.electron` (the preload bridge).
- `src/platform/android.ts` is currently **mostly noops** (`getStore/setStore/getCookie/setCookie/recognizeSong` etc.) — see Gotchas below.
- `BIU_TARGET=android` is **only a build-time env var** for the Rsbuild plugin (skips main-process compile). Runtime dispatch is purely UA-based.

### The IPC contract — 5 places to touch when adding a channel
1. `electron/ipc/channel.ts` — add the channel name (single source of truth).
2. `electron/ipc/<topic>.ts` — register the handler with `ipcMain.handle` / `ipcMain.on`.
3. `electron/ipc/index.ts` — call your `registerXxxHandlers()` function (only if the file is new).
4. `electron/preload.ts` — expose the API method via `contextBridge` (uses `ipcRenderer.invoke` / `send` / `on`).
5. `shared/types/renderer.d.ts` — add the typed signature on the `ElectronAPI` interface.

If the API is also reachable from Android, also add an entry (often a noop) to `src/platform/android.ts` to satisfy the Platform type.

### Multi-window sync
The three Electron windows share renderer state via Zustand stores. Cross-window communication uses **`BroadcastChannel`** (renderer ↔ renderer) and **IPC events** (main ↔ renderer). Examples: download progress (`channel.download.sync`), desktop-lyrics broadcaster (`src/components/lyrics/broadcaster.tsx`), playback-state forwarding to mini player.

### HTTP — main vs renderer
- Main process: **`got` v14** (`got.get(url).json<T>()`, `got.stream(url, opts)`). No CORS issues.
- Renderer: **`axios`** in `src/service/request/`. On Electron, requests that need cookies/UA-spoofing typically go through main IPC; on Android, `service/request/android-adapter.ts` uses Capacitor HTTP to bypass WebView CORS.
- Bilibili API signing (WBI) lives in `electron/network/`.

### Zustand stores
Top-level stores in `src/store/` cover playback (`play-list`, `play-progress`, `lyrics-state`), session (`token`, `user`), persisted user data (`local-fav-items`, `settings`, `search-history`), and shortcuts. **Persistence on Electron** goes through `platform.getStore/setStore` → IPC → `electron-store`. Modal-only stores live under `src/store/modal/`.

### Routing
React Router 7 in hash mode. `src/routes.tsx` declares the main app routes plus the two special standalone-window routes (`/mini-player`, `/desktop-lyrics`) that the corresponding Electron windows load by hash.

### Lyrics system
- Bilibili built-in lyrics: `src/components/lyrics/get-lyrics.ts`.
- User-search modal (Netease + LrcLib tabs): `src/components/lyrics-search-modal/`.
- Cache key is `{bvid}-{cid}` in `StoreNameMap.LyricsCache`.
- The `whisperx-sync` IPC + `electron/python/` aeneas/whisperx scripts are **legacy with no UI caller** — leave alone unless intentionally reviving.

### Desktop lyrics window — STRICT RULE
`electron/desktop-lyrics.ts` window properties **must be set once at construction and never modified**. Do **not** call `setAlwaysOnTop`, `setFocusable`, `moveTop`, or `focus` after creation — doing so triggers `SetWindowPos`/DWM notifications that minimize DirectX exclusive-fullscreen games (LOL, etc.).
- Required constructor flags: `alwaysOnTop: true`, `focusable: false` (Win32 `WS_EX_NOACTIVATE`), `show: false` then `showInactive()` after load, `transparent: true`, `skipTaskbar: true`, `hasShadow: false`.
- macOS only: one-time `setAlwaysOnTop(true, "screen-saver")`. **Windows: don't call it** (all non-`normal` levels map to the same `HWND_TOPMOST`; repeat calls disturb full-screen games).
- Lock-mode hover detection: must use main-process 80ms polling of `screen.getCursorScreenPoint()` via the `desktopLyricsGetCursorRelative` IPC. Forwarded mousemove from `setIgnoreMouseEvents(true, { forward: true })` is unreliable on Windows under `WS_EX_NOACTIVATE + WS_EX_TRANSPARENT`.

## Conventions

### Import order (ESLint perfectionist)
Configured globally in `eslint.config.mjs`. Internal pattern is `^~/.+`, `^@/.+`, `^@shared/.+`. Don't fight the formatter — run `pnpm dlx eslint --fix <file>` if confused.

### Path aliases
- `@/*` → `src/*`
- `@shared/*` → `shared/*`
Defined in `tsconfig.json`, mirrored in `vitest.config.ts`.

### Shared types
`shared/types/*.d.ts` are **ambient global declarations** — used without `import`. The most important is `shared/types/renderer.d.ts` (the `ElectronAPI` interface), which is the source of truth that both `electron/preload.ts` and `src/platform/electron.ts` must conform to.

### Tests
Vitest + jsdom + globals enabled. `tests/setup.ts` mocks `MediaSession` and audio-element APIs. Add new test files under `tests/`. Run a single one with `pnpm test <pattern>`.

### Commits and releases
- `commitlint.config.mjs` enforces Conventional Commits.
- Release flow uses **`changelogen`**, not standard-version. Use `pnpm release[:beta|:alpha]` — it fetches tags, generates the changelog into `CHANGELOG.md`, bumps `package.json`, tags, and pushes.
- Per-release user-facing notes live in `dev_tools/release-notes.md` (shown in-app on update).

### Dead code
`knip.json` whitelists entries: `src/index.tsx`, `electron/main.ts`, `electron/preload.ts`, plus the build plugins.

## Gotchas

### Android platform layer is mostly stubbed
Most methods in `src/platform/android.ts` are noops — particularly the storage layer (`getStore/setStore/clearStore`), cookie handling, and Shazam. Android-specific UI lives in `src/layout/playbar/android.tsx` and `src/components/full-screen-player/android.tsx`. Treat any Android feature work as a port — assume nothing native works until verified.

### Shazam (听歌识曲)
- `electron/ipc/shazam.ts` uses **`node-shazam`** (pure TS + WASM via `shazamio-core`). **No Python.** Older Python pipeline is gone.
- ffmpeg is required for WebM → 16 kHz mono PCM WAV before feeding the WASM fingerprinter. The bundled ffmpeg is stripped (lacks wav/pcm encoders), so use `getFfmpegPath(true)` from `electron/utils.ts` which prefers a full-build binary.

### Two competing memory artifacts
There is a project-scoped MEMORY.md at `~/.claude/projects/-Users-mac-Downloads-biu/memory/MEMORY.md` with deeper, dated notes (desktop lyrics rationale, Android port plan, etc.). When in doubt, this CLAUDE.md is the canonical entry; MEMORY.md has the long-form why.

## See Also
- `docs/windows-setup.md` — Windows env troubleshooting.
- `dev_tools/setup-win.js` — fresh-Windows automation.
