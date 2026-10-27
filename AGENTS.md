# Bazinga — Agent Instructions

This file is the single source of truth for AI coding agents working in this
repo (Claude Code, GitHub Copilot, or others). `CLAUDE.md` and
`.github/copilot-instructions.md` just point back here — edit this file, not
those.

## What this is

Bazinga is a small **Electron** desktop app (not a web app) for working with
coding agents (Claude Code, GitHub Copilot CLI) from inside a lightweight IDE:
terminals, a Monaco diff viewer, a quality-gate panel (lint/types/tests/
security scans), a script runner, and parallel agent runs in separate git
worktrees. See `README.md` for the TL;DR and screenshots, `docs/DOCUMENTATION.md`
for the full feature tour.

## Tech stack

- **Runtime**: Electron (main + renderer, no React/Vue — plain JS + Monaco)
- **Terminals**: xterm.js + node-pty (real pty, not a simulated shell)
- **Editor**: Monaco, no language server by default (language servers are
  opt-in) — completion/refactoring is left to the agent, correctness to the
  quality gates
- **Packaging**: electron-builder (`scripts/dist.js`), CI via
  `.github/workflows/build.yml`
- **Plain JavaScript** throughout — no TypeScript, no bundler/transpiler step,
  no React. Don't introduce these without discussing it first.

## Project layout

```
src/main/      Electron main process (window, pty, preload)
src/renderer/  UI (app.js, styles.css, index.html) — plain JS, no framework
src/core/      Headless logic shared by the app and the CLI (git, checks,
               workflow, scorecard, secrets, etc.) — one file per concern
bin/           CLI entry points (bazinga, ide-check, ide-guard, doctor, statusline)
scripts/       Build/dev scripts (dist, smoke test, screenshots, icons)
test/          node:test files, mostly one per src/core/*.js module
docs/          DOCUMENTATION.md (full feature docs) and screenshots used in README.md
```

`src/core/*.js` modules are meant to be usable both from the Electron app and
headlessly from the CLI (`bin/`). Keep that separation — don't reach into
Electron-only APIs (`BrowserWindow`, IPC, etc.) from `src/core/`.

## Commands

| Task | Command |
|---|---|
| Run the app | `npm start -- /path/to/a/project` |
| Run tests | `npm test` (`node scripts/test.js`, which runs every `test/**/*.test.js` under `node --test`) |
| Run the quality gates on this repo itself | `npm run check` |
| Merge guard (used as a pre-push hook / PR comment) | `npm run guard` |
| Environment diagnostics | `npm run doctor` |
| Headless smoke test | `npm run smoke` |
| Package for distribution | `npm run dist` / `dist:mac` / `dist:win` |

CI (`.github/workflows/build.yml`) runs `npm test` plus the headless smoke
test on Linux, Windows and macOS on every push/PR; only Linux is required to
pass.

## Conventions

- Plain JS, CommonJS or whatever the existing file uses — match the
  surrounding file, don't convert modules between styles as a drive-by.
- No bundler, no TypeScript, no UI framework. If a change seems to need one,
  flag it instead of adding it.
- One `src/core/*.js` module per concern, with a matching `test/<name>.test.js`.
  Follow this pattern for new core logic rather than growing an existing file
  into an unrelated concern.
- User-level settings vs. project config: anything written into the repo goes
  in `.ide/` (`.ide/config.json`, `.ide/scripts.yaml`); anything user-specific
  does not belong in the repo.
- The editor intentionally has no language server wired in by default —
  don't add one as a "nice to have"; it's opt-in by design (see README).

## Things not to do

- Don't add a frontend framework (React/Vue/etc.) to `src/renderer/` — it's
  intentionally plain JS + Monaco.
- Don't add TypeScript or a build/bundle step without discussing it first —
  the project deliberately ships plain JS with no transpile step.
- Don't make `.github/workflows/build.yml` build on every push by default
  without flagging the cost (macOS/Windows CI minutes are expensive on
  private repos — see README "Cost").
- Don't skip or weaken the quality gates (`bin/ide-check.js`,
  `bin/ide-guard.js`) to work around a failure — fix the underlying issue.
- Don't commit secrets; `src/core/secrets.js` / `envscrub.js` exist
  specifically to keep them out of logs and prompts — use them rather than
  bypassing.

## Testing

- Tests use the built-in `node:test` runner, not Jest/Mocha — don't add
  another test framework.
- Add a test alongside any new `src/core/*.js` module (`test/<name>.test.js`),
  mirroring the existing one-module-one-test-file pattern.

<!-- bazinga:folders:start (generated, do not edit between the markers) -->
## Project layout

Project layout (folders the user marked in Bazinga, relative to the project root):
- Source code: src
- Tests: test
Production code belongs in the source folders and tests belong in the test folders. Mirror the path of the code under test (same package or folder structure), and never put a test in a source folder or production code in a test folder.
<!-- bazinga:folders:end -->
