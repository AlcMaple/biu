# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Biu — Bilibili-API-based cross-platform music player. Electron (desktop) + Capacitor (Android). React 19 + Rsbuild for the renderer; the same renderer bundle ships to both platforms. License is PolyForm Noncommercial 1.0.0.

Package manager is **pnpm 10.24.0**, Node **22.17.1** (enforced by `engines`).

> **Read first:** `AI_GUIDELINES.md` is the project's "错题本 + 硬约束" — do/don't rules distilled from real incidents (PCDN stalls, rate-limit retries, desktop-lyrics minimizing games, commit rules). This CLAUDE.md is the architecture map; `AI_GUIDELINES.md` is the list of mistakes not to repeat. Read both.

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
**Run `node dev_tools/setup-win.js` instead of `pnpm install`** on a fresh Windows box. It rewrites Git protocol (avoids SSH), configures pnpm mirrors, and pre-fetches Electron binaries. Idempotent — re-runnable. See `docs/windows-setup.md` for troubleshooting.

## Architecture

### Three processes, one renderer bundle
- **Electron main** (`electron/`) — IPC handlers, native APIs, window management, downloads.
- **Renderer** (`src/`) — React 19 + Zustand + TailwindCSS 4 + HeroUI. **One single bundle** is loaded by 3 windows (main, mini-player, desktop-lyrics) and by Capacitor on Android. Windows differ only by hash route (`/`, `#mini-player`, `#desktop-lyrics`).
- **Android (Capacitor)** — wraps the same `dist/web/` renderer in a WebView.

### Platform abstraction (the linchpin)
At runtime, `src/platform/detect.ts` decides `isElectron = navigator.userAgent.includes("Electron")`; everything else in the platform layer flows from this:
- `src/platform/index.ts` exports a single `platform` object that lazily picks `electron.ts` or `android.ts` (the Android branch dynamically imports `http-android` so Electron builds don't pull in `@capacitor/core`).
- `src/platform/electron.ts` is a thin pass-through to `window.electron` (the preload bridge).
- `src/platform/android.ts` has **real implementations for storage and cookies** (`getStore/setStore/clearStore` via `@capacitor/preferences`, `getCookie/setCookie` via `CapacitorCookies`); most other methods (`recognizeSong`, MediaSession, fonts, window controls, downloads, etc.) are still noops — see Gotchas below.
- `BIU_TARGET=android` is **only a build-time env var** for the Rsbuild plugin (skips main-process compile). Runtime dispatch is purely UA-based — never branch on `BIU_TARGET` at runtime; it doesn't exist there.

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
- **Never fire cookie/UA-dependent Bilibili requests with raw renderer axios** — WebView CORS blocks them and login cookies/signatures won't attach.

### Zustand stores
Top-level stores in `src/store/` cover playback (`play-list`, `play-progress`, `lyrics-state`), session (`token`, `user`), persisted user data (`local-fav-items`, `settings`, `search-history`), and shortcuts. **Persistence on Electron** goes through `platform.getStore/setStore` → IPC → `electron-store`; **on Android** the same calls hit `@capacitor/preferences`. Always persist through `platform.*`, never localStorage directly, or Android drops the state on restart. Modal-only stores live under `src/store/modal/`.

### Routing
React Router 7 in hash mode. `src/routes.tsx` declares the main app routes plus the two special standalone-window routes (`/mini-player`, `/desktop-lyrics`) that the corresponding Electron windows load by hash.

### Lyrics system
- Bilibili built-in lyrics: `src/components/lyrics/get-lyrics.ts`.
- User-search modal (Netease + LrcLib tabs): `src/components/lyrics-search-modal/`.
- Cache key is `{bvid}-{cid}` in `StoreNameMap.LyricsCache`.
- The `whisperx-sync` IPC + `electron/python/` aeneas/whisperx scripts are **legacy with no UI caller** — leave alone unless intentionally reviving.

### Desktop lyrics window — STRICT RULE
`electron/desktop-lyrics.ts` window properties **must be set once at construction and never modified**. Do **not** call `setAlwaysOnTop`, `setFocusable`, `moveTop`, or `focus` after creation — doing so triggers `SetWindowPos`/DWM notifications that minimize DirectX exclusive-fullscreen games (LOL, etc.). This is a real incident's root cause.
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

### Error handling & retries
Do **not** add app-level auto-retry, periodic "did it recover yet?" probing, or silent `catch → return null` on rate-limit / 5xx failures — retrying inside the penalty window worsens throttling, and swallowed errors make users hammer manually. Surface failures to the UI with error-type-specific copy (playback errors should guide "switch quality / re-parse"). The only allowed code-level retry is a single transient transport blip (ECONNRESET-level), never a business failure. See `AI_GUIDELINES.md` for the full rationale.

### Tests
Vitest + jsdom + globals enabled. `tests/setup.ts` mocks `MediaSession` and audio-element APIs. Add new test files under `tests/`. Run a single one with `pnpm test <pattern>`. Type/unit passing ≠ correct behavior — playback and cross-window sync must be driven in a real window before claiming a fix.

### Commits, DEVLOG, and releases
- **Before every commit, add a `DEVLOG.md` entry** (per its format header) — this is a required delivery step, not optional. Group multiple commits of the same feature under one `##` heading; pits/design trade-offs go in the matching `docs/ideas/` file, not DEVLOG.
- `commitlint.config.mjs` enforces Conventional Commits with **Chinese descriptions**: `<type>(<scope>): <描述>`. Title states the user/dev-visible symptom or result, not low-level terms (those go in the body). See `docs/Git.md`.
- **Do NOT add an AI-signature trailer** (e.g. `Co-Authored-By: Claude ...`) — commit history is presented uniformly as the developer, matching existing `git log`. (This overrides the default Claude Code co-author convention.)
- Only commit / push when the user explicitly asks; on the default branch, create a branch first.
- Release flow uses **`changelogen`**, not standard-version. Use `pnpm release[:beta|:alpha]` — it fetches tags, generates `CHANGELOG.md`, bumps `package.json`, tags, and pushes. Per-release user-facing notes live in `dev_tools/release-notes.md` (shown in-app on update).

### Dead code
`knip.json` whitelists entries: `src/index.tsx`, `electron/main.ts`, `electron/preload.ts`, plus `plugins/rsbuild-plugin-electron.ts`.

### Project ideas log
Phased development notes live in `docs/ideas/` (numbered `NNN-<topic>.md`). The highest-numbered file is the in-progress phase (currently `003-私人FM.md`). Bugs, root causes, and design deliberations for a feature belong here, not in DEVLOG.

## Gotchas

### Android platform layer is partially wired
**Storage and cookies work** on Android (`getStore/setStore/clearStore` → `@capacitor/preferences` with a `biu:` key prefix; `getCookie/setCookie` → `CapacitorCookies` against `.bilibili.com`, mirroring `electron/ipc/cookie.ts`). This unblocks token / local-fav / settings / lyrics-cache persistence. **Still noops**: Shazam (`recognizeSong`), MediaSession (no background play / notification / lock-screen / headset / AudioFocus), fonts, window controls, downloads, and the WhisperX/desktop-lyrics methods. Android-specific UI lives in `src/layout/playbar/android.tsx` and `src/components/full-screen-player/android.tsx`. Treat any *other* Android feature as an unimplemented port until verified.

### Stream selection — avoid PCDN stalls
Bilibili `playurl` often returns `mcdn` / `szbdyd` (PCDN) nodes as the first `baseUrl`; under proxies (Clash etc.) these stall — the stream downloads but won't play. **Prefer `upos` domains and demote PCDN nodes to fallback.** First step when debugging playback is always `%APPDATA%\biu\logs\main.log`. (See memory `bilibili-pcdn-stream-stalls`.)

### Play counts
`fav/resource/list` returns `cnt_info.play=0` for some videos; showing it verbatim yields fake "0 plays". Back-fill zero-hits via the `infos` endpoint and distinguish `vt` (new counter) from legacy `play`. (See memory `bilibili-fav-list-play-zero`.)

### Shazam (听歌识曲)
- `electron/ipc/shazam.ts` uses **`node-shazam`** (pure TS + WASM via `shazamio-core`). **No Python.**
- ffmpeg is required for WebM → 16 kHz mono PCM WAV before feeding the WASM fingerprinter. The bundled ffmpeg is stripped (lacks wav/pcm encoders), so use `getFfmpegPath(true)` from `electron/utils.ts` which prefers a full-build binary.

### Persisted data must be portable
Local favorites support export/backup (`docs/local-favorites-backup.md`). Never persist machine-absolute paths (`file:///C:/Users/...`) into syncable data — store portable identifiers (bvid, relative path, URL) and compute local paths per-device at display time.

## See Also
- `AI_GUIDELINES.md` — do/don't rules from real incidents (read alongside this file).
- `DEVLOG.md` — running development log; add an entry before each commit.
- `docs/ideas/` — phased feature design notes.
- `docs/windows-setup.md` — Windows env troubleshooting.
- `dev_tools/setup-win.js` — fresh-Windows automation.
