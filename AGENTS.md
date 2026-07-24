# Repository Guidelines

## Project Structure & Module Organization

Biu is a TypeScript application targeting Electron desktop and Capacitor Android. Renderer code lives in `src/`: pages are under `src/pages/`, reusable UI in `src/components/`, Zustand state in `src/store/`, and platform adapters in `src/platform/`. Electron main-process, preload, IPC, updater, and native-window code belongs in `electron/`. Cross-process types and settings live in `shared/`; build integration is in `plugins/`. Keep unit tests in `tests/` and documentation in `docs/`. Android native output is under `android/`, while screenshots and application artwork are stored in `screenshots/` and `src/assets/`.

## Build, Test, and Development Commands

Use Node `22.17.1` and pnpm `10.24.0`.

- `pnpm install --frozen-lockfile` installs the locked dependency set.
- `pnpm dev` starts the desktop development build with Rsbuild.
- `pnpm dev:android` serves the Android-targeted renderer.
- `pnpm build` type-checks/builds the application and creates platform artifacts.
- `pnpm build:android` builds the web bundle and syncs it into Capacitor.
- `pnpm test` runs Vitest in watch mode; use `pnpm run test -- --run` for a single CI-style pass.
- `pnpm exec eslint .` checks TypeScript/JavaScript, and `pnpm knip` reports unused code and dependencies.

## Coding Style & Naming Conventions

Use two-space indentation, LF endings, TypeScript strict mode, semicolons, double quotes, and a 120-character line width. Prettier (including Tailwind class sorting), ESLint, and Stylelint define the canonical format. Components use PascalCase exports, hooks begin with `use`, and files/directories generally use kebab-case (`music-list-item/index.tsx`). Prefer `@/` and `@shared/` aliases over long relative imports. Keep renderer code away from Node, filesystem, and privileged network APIs; expose those capabilities through typed IPC and platform adapters.

## Testing Guidelines

Tests use Vitest, jsdom, and Testing Library setup from `tests/setup.ts`. Name tests `*.test.ts` or `*.test.tsx` and place them in `tests/`, following examples such as `tests/play-list.test.ts`. Add focused coverage for state transitions, platform behavior, and regressions. Run the affected test file plus `pnpm run test -- --run` before opening a PR; manually exercise window, playback, or cross-platform behavior that jsdom cannot validate.

## Commit & Pull Request Guidelines

Follow Conventional Commits with concise Chinese descriptions: `feat: 新增播放模式` or `fix(lyrics): 修复时间轴偏移`. Allowed types are documented in `docs/Git.md`; scopes are optional. Update `DEVLOG.md` for substantive work. PRs should explain the user-visible result, link relevant issues, list verification performed, and include screenshots or recordings for UI changes. Ensure tests, ESLint, Knip, and applicable platform builds pass.
