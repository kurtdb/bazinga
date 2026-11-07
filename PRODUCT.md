# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Note: Bazinga is an Electron desktop app (Windows/macOS/Linux), not a browser-hosted site — "web" is
the closest fit in this schema since the renderer is plain HTML/CSS/JS, but nothing here ships to a
browser.

## Users

Developers who are already comfortable reviewing diffs and PRs, and who run one or more AI coding
agents (Claude Code, GitHub Copilot CLI, OpenAI Codex CLI, Google Gemini CLI, Aider, local models, or
any other CLI/ACP agent) against real codebases. They are not learning to code — they are trying to
scale how many agents they can responsibly run at once without losing track of what those agents did.

## Product Purpose

Let someone work *with* coding agents instead of hand-writing everything, while keeping those agents
honest (quality gates, merge guard, scope allowlists, weakened-test detection, a scorecard of
agent/task-kind win rates) and productive (parallel runs each in its own git worktree, "best of N"
comparisons, workflows, auto-merge once a pairing has a proven track record). Success means
trustworthy, reviewable throughput from multiple agents — not just "an agent wrote some code."

## Positioning

Not another agent or chatbot. Bazinga is the orchestration-and-trust layer that sits around whichever
agents the user already runs, agent-agnostic by design. The mechanism a single-agent chat UI or a bare
git-worktree script doesn't offer together: parallel isolated runs + deterministic per-language
quality gates + a merge guard with adaptive, self-relaxing rules + a scorecard that learns which agent
wins which kind of task from the user's own merge/discard history.

## Operating Context

Real terminals (pty, not simulated) for whichever CLI/ACP agent the user runs; a Monaco diff viewer
over agent changes with per-hunk stage/revert; a quality-gate panel (lint/types/tests/security scans)
across JS/TS, Python, Java, Go, Rust and C# out of the box; a file tree, project search, commit
graph/stash/blame; a Fleet dashboard and Board view across parallel agent runs; workflows defined as
YAML chaining agent runs with gates and approvals; a command line usable with no window at all
(`bazinga check`/`guard`/`hook install`/`proxy`).

## Capabilities and Constraints

- Plain JavaScript throughout (no React/Vue, no TypeScript, no bundler/transpile step) — deliberate,
  not a gap to close.
- No language server wired in by default; opt-in only, by design.
- Electron desktop app for Windows/macOS/Linux, packaged with electron-builder; CI builds on every
  push.
- Ships nine themes including high-contrast in both polarities (low vision) and a low-blue-light
  night mode, plus a custom-theme builder from three seed colors with guaranteed contrast; no further
  accessibility requirement beyond what's already shipped has been confirmed.
- Works with any CLI or ACP agent, not tied to one vendor.

## Brand Commitments

Plain-spoken, developer-to-developer voice with no marketing gloss — observed consistently in the
README's own phrasing ("instead of typing all the code yourself," explicit caveats about which
screenshots are scripted stand-ins vs. the real app). No invented tagline or slogan; treat overly
polished/sales-y copy as off-voice for this product. The name "Bazinga" itself carries a light,
irreverent tone worth preserving rather than smoothing away.

## Evidence on Hand

Real screenshots against a demo project in `docs/screenshots/` (light and dark variants), referenced
from `README.md`; regenerated via `npm run screenshots`. Per the README's own caveat: the terminal
"agent" and the AI-review answer shown in screenshots are scripted stand-ins, everything else
(worktrees, gates, flags, dialogs) is the real app — do not treat the scripted parts as a UI contract,
and do not invent additional testimonials, benchmarks, or pricing; none exist.

## Product Principles

1. Agent-agnostic: no part of the core experience should assume one specific agent vendor.
2. Trust is earned mechanically, not asserted — gates, scorecards, and merge guard rules exist so the
   user doesn't have to take an agent's word for it.
3. No framework tax: plain JS and no bundler keep the app inspectable and fast to change.
4. Restraint over spectacle in the UI itself (this is an "Operate"-mode tool: scanability and native
   expectations outrank expression) — brand shows up in precise details, not loud visual statements.
5. Everything meaningful stays usable headlessly from the command line, not locked behind the window.
