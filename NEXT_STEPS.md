# Next steps

A working list of what could reasonably come next. Nothing here is committed to — it's a menu, not a backlog.
Finished work lives in `CHANGELOG.md` and git history, not here, so this file stays short: when something below
is done, delete it rather than leaving a struck-through retrospective in its place.

## "Run this test" / Debug — intentionally not pursued, so it isn't re-litigated
- **Rust**: no "wait for a debugger" mechanism as clean as Delve/JDWP/`VSTEST_HOST_DEBUG`. The realistic option -
  locating the hashed test binary under `target/debug/deps/` for `rust-lldb` - was judged too fragile to ship
  without the toolchain here to verify against.
- **Scala**: no debug lens either - sbt's `-jvm-debug` flag targets sbt's own launcher JVM, not necessarily a
  project's forked test JVM, which depends on that project's own `build.sbt`. ScalaTest/WordSpec's BDD style
  (`"x" should "y" in { }`) also has no "run this test" lens - only the plain `test("name") { }` shape
  (FunSuite/MUnit) is recognised.
- **Swift and C/C++** were considered for "run this test" entirely and dropped: Swift's debugging is Xcode-centric
  rather than CLI-attach friendly, and C/C++ has no language-level standard test framework (every project picks
  its own, the same multi-framework problem JS has, worse).

## Gradle gates/deps — known, narrower gaps left after closing the earlier Gradle gap
- **Gradle dependency parsing only recognizes the dominant single-GAV-coordinate string form**
  (`implementation 'group:artifact:version'`/`implementation("group:artifact:version")`). Map-style
  dependencies (`group:`/`name:`/`version:`) and version catalogs (`libs.versions.toml`) aren't parsed -
  same kind of deliberate scope limit as Maven's own `dependencyManagement`/unresolved-`${property}` gaps.
- **Multi-module Gradle builds aren't independently verified** against a real multi-project fixture - a
  single task name run from the root is expected to scope correctly across subprojects (Gradle's own
  behavior, not something Bazinga arranges), but this hasn't been exercised against a real composite build.

## Rename / "Go to symbol in workspace" / AI inline completion / Debugger — known, deliberate gaps
- **Debugging is Python-only (debugpy.adapter)**: Go's `dlv dap` speaks DAP too, but over a TCP socket Delve
  opens itself, not stdio like debugpy - a different transport than `core/dap.js` implements, and there was no
  `go`/`dlv` toolchain here to verify a stdio-vs-socket client against. Every other language keeps the existing
  "Debug this test" lens (Settings -> a Debug lens), which waits for your own IDE's debugger to attach, instead.
- **Rename is LSP-only**: a file with no configured language server has no fallback rename - same gating
  `textDocument/rename` already uses for every other LSP-backed feature.
- **"Go to symbol in workspace" (Ctrl+T) has no incremental cross-reference with the LSP "exact usages" lens** -
  the workspace symbol index (tree-sitter/regex, same parser the symbol lenses use) and LSP's own usage-finding
  are separate systems; a rename doesn't refresh the symbol index until the next file-watcher pass.
- **AI inline completion is Ollama-only** (fill-in-the-middle via `/api/generate`'s `suffix` field) - no generic
  OpenAI-style FIM endpoint support. Off by default; Settings -> Editor turns it on and picks the model.

## Semgrep (SQL injection / XSS coverage) — verified, narrower than "p/default" sounds
- Confirmed empirically (hand-written vulnerable Python/Flask and Node/Express samples) that the configured
  `p/default` ruleset genuinely catches real SQL injection (Flask/SQLAlchemy raw string concatenation) and XSS
  (Express `res.send`/raw-HTML-format) patterns - not just a plausible-sounding ruleset name.
- The real, narrower gap: a SQL string built via concatenation against a data-access object the ruleset doesn't
  recognize (e.g. a bespoke `db.query(...)` wrapper, not a named ORM/driver) is missed - the rules match known
  framework/ORM call shapes, not "any string concatenated into anything called `.query`/`.execute`".
- `p/security-audit` was considered as a swap and empirically rejected: on the same samples it ran fewer rules
  and found **zero** of the six findings `p/default` catches (an unauthenticated `semgrep scan` gets a reduced,
  non-Pro rule set from that pack specifically) - switching would have been a regression dressed up as a fix.

## Bundled grill-with-docs / grilling / domain-modeling — known, deliberate gap
- **`grill-with-docs` calls its two sibling skills by name, with no enforcement that they're installed
  together.** Bazinga's bundled-skill install is per-skill (one folder, one `Install` click); there's no
  "this skill needs these other skills too" dependency concept. Installing `grill-with-docs` alone leaves
  it calling the `Skill` tool for `grilling`/`domain-modeling` and finding nothing. Noted in each skill's
  own description/NOTICE.md; not enforced in the UI.

## Bundled EGM skills — known, deliberate gap
- **Reviewer/worker isolation is instruction-level only, not tool-restricted.** Upstream EGM's Claude Code
  plugin registers each reviewer persona as a named subagent type with a hard `tools: [Read, Grep, Glob]`
  restriction (enforced by Claude Code itself) via `.claude-plugin/plugin.json`. This bundled copy (no
  plugin install - see `docs/DOCUMENTATION.md`) has no equivalent registration mechanism, so a spawned
  reviewer is a general-purpose subagent told to read its persona file and stay read-only - the persona's
  own "you are a strictly read-only agent" instruction, not an enforced tool list. Bundling a real
  `.claude/agents/*.md` registration would need a new install mechanism in `src/core/skills.js` beyond its
  current "one self-contained skill folder" model - not pursued here as out of scope for "bundle the skill".

## Agent configuration panel (`core/agentconfig.js`) — known, deliberate limits
- **Global (home-directory) scanning is real but uneven across runners**, each item tagged `scope:
  'project'`/`'global'` and grouped under a "Global (~, every project on this machine)" divider in the
  dialog. Claude's side (`~/.claude/skills`, `~/.claude/agents`, `~/.claude/settings*.json`,
  `~/.claude/CLAUDE.md`) is verified against this project's own `skills.js` convention and against a
  real `~/.claude` on a dev machine. Codex's `~/.codex/config.toml`/`hooks.json` and Gemini's
  `~/.gemini/settings.json` are the tools' documented home-level config locations but weren't checked
  against a live installation here (neither was present on the machine this was built on). Copilot's
  global agents (`~/.copilot/agents/*.md`) are verified real; its global MCP file
  (`~/.copilot/mcp-config.json`, read the same `servers` shape as the project-level `.vscode/mcp.json`)
  is **unverified** - no such file existed to check on this machine, so the filename and key name are
  a best guess, not a confirmed source. Claude Code also keeps a *third*, project-scoped-but-personal
  MCP record per project inside `~/.claude.json` (`projects["<abs path>"].mcpServers`, confirmed on a
  real `~/.claude.json` - the top level has no flat global `mcpServers` key at all, despite that being
  the more obvious guess) - deliberately not surfaced here, since it's neither "this project's committed
  config" nor "applies to every project," and folding it into either scope would misrepresent it.
- **Codex's project `.codex/config.toml` tiering is third-party-sourced** (blogs, a config-generator
  site), not confirmed against OpenAI's own documentation - the reader degrades gracefully (skips,
  doesn't crash) if the file is absent or shaped differently than expected, but the location/precedence
  itself hasn't been verified against an official source.
- **The TOML reader is a narrow hand-rolled subset** (table headers plus simple `key = "value"` /
  `key = [...]` lines), not a general TOML parser - multi-line strings, inline tables, and dotted keys
  are silently skipped rather than guessed at.
- **Copilot's `applyTo` frontmatter sniff is best-effort.** `.github/instructions/*.instructions.md`'s
  scoping field is read with the same crude single-line frontmatter parser used everywhere else in this
  codebase (see `parseSkillMd`'s own limit) - a multi-line or oddly formatted `applyTo` is not read.
- **Gemini CLI's manifest-based extensions** (`~/.gemini/extensions/*/gemini-extension.json`) aren't
  scanned - they use a different mechanism (a manifest, not a settings key) than the `mcpServers` entries
  this panel does read from `settings.json` at both levels.

## Fetched-skill scan (`core/skillscan.js`) — known, deliberate limits
- **Pattern-matching, not a security review.** Catches the shapes it has a rule for (hidden/invisible
  Unicode, download-and-execute, destructive commands, prompt-injection phrasing) - a sufficiently
  obfuscated or novel attempt can still pass clean, the same caveat the secrets gate already carries.
  `Fetch` and `Update` are both gated on it now (closed the earlier gap where an update bypassed the scan
  entirely); normalization (homoglyph/zero-width stripping) and one-level base64 decode-and-rescan raise
  the bar against trivial evasion but don't close it - the confusables map is a small hand-picked subset
  of Latin-lookalike Cyrillic/Greek letters, not the full Unicode confusables table, and the base64 rescan
  is one level deep only (a double-encoded or differently-encoded payload still passes clean).
- **Recommended (bundled) skills are not scanned at list/install time** - they ship with the app and are
  reviewed once by whoever adds them, not fetched from an untrusted source on every open. Covered instead
  by a one-time regression test (`test/skillscan.test.js`) asserting the bundled set stays clean.

## "Dependency problems" (Usage & insights) — known, deliberate gaps
- **OWASP dependency-check was considered for the Maven vulnerability check and deliberately not used**: its first
  run downloads a large NVD CVE mirror (minutes to hours without an NVD API key), which doesn't fit a quick
  "Check now" click the way `npm audit`/Dependabot do. OSV.dev's free, keyless batch API was used instead - no
  local database, no API key, fast enough for an on-demand check. Noted so this isn't revisited without reason.

## Playwright — considered, not pursued
`npm run smoke` already drives the real Electron app end to end, but by calling the renderer's own JS functions
directly (e.g. `press('Dependency problems')`) rather than dispatching real synthetic clicks/DOM events. That means
it exercises the actual logic paths but can't catch a button that's visually unclickable - CSS covering it, a
listener never attached, a z-index overlap. Playwright (via its `_electron` driver) would close exactly that gap,
at the cost of a new heavy dependency (bundled Chromium/Electron driver binaries) and a second E2E paradigm to
maintain alongside the self-driving smoke suite already in place. A real but narrow win, not pursued for now given
how much the current suite already covers.
