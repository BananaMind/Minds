# Repository Guidelines

## Project Structure & Module Organization

Minds is a JavaScript ES-module npm workspace. `packages/core/src/` contains the host, bot runner, tools, scheduler, and providers. `packages/cli/` is the terminal client; `packages/p2p/src/` handles pairing and transport. The shared Preact UI lives in `packages/ui/src/`, with components in `components/`, CSS in `styles.css`, and SVG avatars in `components/BotIcon.jsx`.

Electron and Capacitor shells live in `apps/desktop/` and `apps/mobile/`. Android assets are in `apps/mobile/android/app/src/main/res/`. Tests live in `packages/core/test/` and `packages/p2p/test/`; documentation and diagnostic scripts live in `docs/` and `scripts/`.

## Build, Test, and Development Commands

Use Node.js 20+ and run these commands from the repository root:

- `npm install`: install workspace dependencies.
- `node node_modules/electron/install.js`: download Electron during initial setup.
- `npm run ui:build`: build the shared UI into `packages/ui/dist/`.
- `npm run dev -w @bananamind/minds-ui`: start the Vite development server.
- `npm run desktop`: build the UI and launch Electron.
- `npm run daemon` / `npm run cli`: run the host or terminal client.
- `npm test`: run core and P2P tests.
- `npm run apk -w @bananamind/minds-mobile`: sync the UI and build an Android debug APK; requires Java and the Android SDK.

## Coding Style & Naming Conventions

Follow existing code: two-space indentation, single quotes, semicolons, and explicit `.js` extensions in relative imports. Use `camelCase` for functions and variables, `PascalCase` for classes and JSX components, and lowercase or kebab-case utility filenames. Tool modules use names such as `read_file.js`. No formatter or linter is configured.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Name files `*.test.mjs` and describe behavior in test names. Run a focused suite with `node --test packages/core/test/core.test.mjs`. Isolate state with temporary `MINDS_HOME` and `MINDS_CODEX_AUTH` paths. Add regression tests for behavior changes; no coverage threshold is configured.

## Commit & Pull Request Guidelines

There are no commits yet, so no historical convention exists. Use concise, imperative messages, optionally scoped, such as `core: Fix scheduler recovery`. PRs should describe behavior changes, link relevant issues, report validation, and include screenshots for UI changes.

## Security & Configuration Tips

Keep credentials, pairing secrets, and runtime data out of Git. Use `MINDS_HOME` to isolate development data from `~/.minds`. Consult `docs/MOBILE.md` before changing pairing or remote permissions.
