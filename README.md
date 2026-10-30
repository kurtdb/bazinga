# Bazinga

A small Electron app for working **with** coding agents instead of typing all the code yourself.

Full documentation (every feature, configuration, CI integration, known limits...) lives in **[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)**. This file is just the TL;DR and a quick start.

## TL;DR

**Core IDE**
- Real terminals for Claude Code, GitHub Copilot CLI, OpenAI Codex CLI, Google Gemini CLI and Aider (pty via xterm.js + node-pty), plus any other CLI or ACP agent
- Monaco diff viewer over whatever the agent changed, editable, with per-hunk stage/revert, and an optional semantic-diff summary (renamed/moved/added/removed classes, methods and functions, not just changed lines)
- Quality gates (lint, types, tests, security scans, duplicate-code/duplicate-component detection) on changed files, covering JS/TS, Python, Java, Go, Rust and C# out of the box — a Problems panel plus editor squiggles
- Script runner for your own commands, file tree with new/rename/duplicate/delete and source/test folder marking, project search with replace-all across files, quick open, commit graph/stash/blame, no bundler, no language server by default (opt-in; presets for Java, Python, TS/JS, Go, Rust and C#)

**Agent runs**
- Parallel agents, each in its own git worktree and branch — review, merge (squash or merge commit) or discard independently
- Compare two runs side by side; "best of N agents" on one task, ranked by the gates, pick a winner
- Board view (backlog → running → needs you → ready to review) and a Fleet dashboard (context meter, tokens, cost, stale/needs-approval state)
- Scorecard: which agent wins which kind of task and at what cost, from your own merge/discard history; optional hand-over to a stronger agent after N failed fix rounds
- Session replay: scrub step by step through a run's journal and the commits it made, before and after the fact
- Auto-merge (opt-in, off by default): once the gates are clean, merge without asking — but only for an agent/task-kind pairing with a proven scorecard track record; always undoable from the run list

**Keeping agents honest**
- Task allowlist (scope flags on out-of-scope files), weakened/deleted-test detection, agent self-reported-summary cross-check, reviewed checkmarks
- Oversight levels (Autonomous → Supervised → Guided → Step by step) controlling the fix loop, merge guard strictness and notifications
- Merge guard: protected paths, weakened tests, scope, unreviewed files — `block`/`warn`/`off` per rule, enforceable in CI too (`bazinga guard --comment` on a PR) with a shared policy floor; adaptive — a rule you keep overriding offers to relax itself after a few times
- Optional Docker container per agent run (dropped capabilities, no network by default, scrubbed credentials)

**Workflows**
- Chain agent runs with gates and approvals, defined as readable YAML, with a visual graph, a form-based editor and a self-check
- Per-step model choice, time limits, resume after a restart, unattended mode (`claude -p`), merge-when-clean

**Local models**
- Plug in Ollama (or any OpenAI-style server) through the normal agent mechanism — presets, remote servers, per-model context handling
- A tool-call repair helper for small models (fixes malformed/misnamed tool calls, can slim Claude Code's own prompt), plus a one-click model test and qwen3 `/no_think` handling

**Integrations**
- Work items from Jira or Azure Boards, skills (skills.sh-compatible, searchable, shared across agents), Jev task classification (opt-in, off by default)
- Claude Code hooks (done/permission signals), version watch, OpenTelemetry cost tracking, an MCP server, ACP agent support, GitHub Copilot usage link, SonarCloud/dependency/coverage checks, auto-update (checks by default, never downloads or installs without a click)

**Command line (no window needed)**
- `bazinga check` (quality gates, also a Claude Code hook), `bazinga guard` (merge guard, with PR comments), `bazinga hook install` (git pre-push hook), `bazinga proxy` (the local-model helper standalone)

**Platform**
- Electron desktop app, Windows/macOS/Linux, packaged with electron-builder, CI builds on every push
- Nine themes including high-contrast in both polarities (low vision), a night (low blue light) mode, and Tron/WarGames for fun — or build your own from three seed colours, with contrast guaranteed; pick your coding font too (JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono, or the Roboto Mono default); everything else — notifications, undo, local history, environment check and more — in the full docs

## Quick start

```powershell
cd bazinga
npm install
npm start -- C:\path\to\your\project
```

Prerequisites, macOS/Linux specifics, building your own installer and CI builds from GitHub: see **[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)**.

## Screenshots

Real UI against a demo project (dark below; light versions in `docs/screenshots/light/`) (`npm run screenshots` regenerates them). The terminal "agent" and the AI-review answer are scripted stand-ins; everything else (worktrees, gates, flags, dialogs) is the real app.

| | |
|---|---|
| ![Agent runs](docs/screenshots/1-agent-runs.png) **Agent runs**: three agents in their own worktrees | ![Review flags](docs/screenshots/2-review-flags.png) **Review**: scope, edited-test and unlisted-file flags |
| ![Quality gates](docs/screenshots/3-quality-gates.png) **Quality gates**: duplicate component, console.log | ![AI review](docs/screenshots/4-ai-review.png) **AI review** of the diff plus findings |
| ![Merge](docs/screenshots/5-merge.png) **Merge** a finished run, with the merge guard | ![Settings](docs/screenshots/6-settings-local-model.png) **Settings**: local model agent and review command |
| ![History](docs/screenshots/8-history.png) **History**: commit graph, stash, blame | ![Quick open](docs/screenshots/7-quick-open.png) **Quick open** |
| ![Lenses](docs/screenshots/9-code-lenses.png) **Lenses**: usages and last change above each function | ![Compare](docs/screenshots/10-compare-runs.png) **Compare** two agent runs |
| ![Environment](docs/screenshots/11-environment-check.png) **Environment check**: what is installed, what is missing | ![Folders](docs/screenshots/12-folder-roles.png) **Folder roles**: mark source and test folders |
| ![Workflow](docs/screenshots/13-start-workflow.png) **Workflow**: steps, a model per step | ![Self-check](docs/screenshots/14-workflow-selfcheck.png) **Workflow self-check**: does chaining work with your agent? |
| ![Debug](docs/screenshots/15-debug-log.png) **Debug log**: what the workflow and the agents are doing | ![Session replay](docs/screenshots/16-session-replay.png) **Session replay**: scrub through a run's events and commits |
| ![Guard suggestion](docs/screenshots/17-guard-suggestion.png) **Adaptive guard rules**: offers to relax a rule you keep overriding | ![Semantic diff](docs/screenshots/18-symbol-diff.png) **Semantic diff**: renamed/added/removed symbols, not line noise |
| ![Auto-merge](docs/screenshots/19-auto-merge-setting.png) **Auto-merge**: merges on its own once the gates are clean and the track record is strong | |

Language servers are opt-in (see the full docs); there is no extension host and no indexer. Memory use has not been measured, but with nothing running in the background it should idle well below IntelliJ, and nothing can hang the way a project re-index does. The gates (compile, tests) are the heavy part, and they run as separate processes you can cancel.

---

**→ [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)** for everything else: build/CI, Setup & health, every feature above in detail, local models, oversight and the merge guard, workflows, all integrations, the command line, packaging, tests, known limits, layout, theming and icons.
