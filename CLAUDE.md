# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Biu** is a cross-platform desktop music player built on Bilibili's public APIs. It uses Electron as the app shell and React for the renderer UI, bundled with Rsbuild.

## Commands

```bash
# Install dependencies (uses pnpm)
pnpm install

# Start development (launches Electron + Rsbuild dev server)
pnpm dev

# Production build (outputs to dist/)
pnpm build

# Run tests
pnpm test

# Run a single test file
pnpm vitest run tests/play-list.test.ts

# Lint (ESLint)
pnpm eslint .

# Check unused exports/imports
pnpm knip
```

Commit messages must follow Conventional Commits (`feat:`, `fix:`, etc.) — enforced by commitlint.

## Architecture

This is a **two-process Electron app**:

### Main Process (`electron/`)
- `main.ts` — Entry point; creates `BrowserWindow`, sets up IPC, tray, shortcuts, auto-updater.
- `preload.ts` — Exposes `window.electron` to the renderer via `contextBridge`. All renderer↔main communication goes through this.
- `ipc/` — IPC handler modules organized by domain (`download`, `store`, `dialog`, `cookie`, `font`, etc.). `channel.ts` is the single source of truth for all IPC channel names.
- `store.ts` — Electron-side persistent store (electron-store) for app settings.
- `network/` — Cookie injection and web request interceptors to attach Bilibili auth cookies to API requests.
- `mini-player.ts` — Manages the secondary mini-player `BrowserWindow`.

### Renderer Process (`src/`)
- Built with **React 19**, **React Router 7**, **Zustand**, **TailwindCSS 4**, **HeroUI**.
- `src/routes.tsx` — All app routes. The root layout wraps all main pages; `/mini-player` is a standalone route.
- `src/store/` — Zustand stores. Stores that need persistence delegate to `window.electron.getStore`/`setStore` (backed by electron-store in the main process), not `localStorage`.
- `src/service/` — One file per Bilibili API endpoint. Requests use preconfigured axios instances from `src/service/request/index.ts` (`apiRequest`, `passportRequest`, `searchRequest`, `memberRequest`, `biliRequest`). The `requestInterceptors` applies WBI signing to authenticated requests.
- `src/components/` — Shared UI components (music controls, lists, modals, etc.).
- `src/pages/` — Page-level components corresponding to routes.
- `src/layout/` — Shell layout with side nav, navbar, and playbar.

### Shared (`shared/`)
Code shared between the main and renderer processes. Import via `@shared/` alias.
- `shared/types/` — TypeScript `.d.ts` global type declarations (e.g., `ElectronAPI`, `AppSettings`, `AppPlatForm`).
- `shared/settings/` — Default values for app settings and shortcut settings.
- `shared/store/` — Store name constants (`StoreNameMap`).
- `shared/path/` — Common file path constants used in build.

### Build / Plugins (`plugins/`)
Custom Rsbuild plugin (`rsbuild-plugin-electron.ts`) that hooks into the build lifecycle:
- On first dev compile: bundles the Electron TypeScript (`electron-config-build.ts`) then spawns Electron (`electron-dev.ts`).
- On production build: cleans `dist/`, bundles Electron TS, then runs `electron-builder` (`electron-build.ts`) outputting to `dist/artifacts/`.

### Path Aliases
| Alias | Resolves to |
|---|---|
| `@/*` | `src/*` |
| `@shared/*` | `shared/*` |

## Key Patterns

- **IPC communication**: Renderer calls `window.electron.<method>()` (defined in `preload.ts`). Main process registers handlers in `electron/ipc/index.ts`. All channel strings live in `electron/ipc/channel.ts` — always use these constants, never hardcode strings.
- **State management**: Zustand stores for renderer state. Persistent settings sync to electron-store via custom storage adapters — see `src/store/settings.ts` for the pattern.
- **API requests**: Each Bilibili endpoint gets its own file in `src/service/`. Use the appropriate pre-configured axios instance from `src/service/request/index.ts` based on the API's host.
- **Dev/prod isolation**: In dev mode, Electron uses a separate `userData` path (`biu-dev`) to avoid polluting production data.
- **Import ordering**: ESLint `perfectionist/sort-imports` enforces a strict import order — React → external → internal (`@/`, `@shared/`) → relative.
