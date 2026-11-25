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
- **Multi-module Gradle builds aren't independently verified** against a real multi-project fixture - a
  single task name run from the root is expected to scope correctly across subprojects (Gradle's own
  behavior, not something Bazinga arranges), but this hasn't been exercised against a real composite build.

## Rename / "Go to symbol in workspace" / AI inline completion / Debugger — known, deliberate gaps
- **The real debugger (Run & Debug panel) now also covers Go (`dlv dap`, over the TCP socket Delve opens
  itself - `core/dap.js`'s `DapClient` takes a transport abstraction now, stdio or TCP) and Dart
  (`dart debug_adapter`, stdio). Neither was verified against a real toolchain (no `go`/`dlv` or Dart SDK in
  the environment this was written in) - only the protocol framing and `DapSession` choreography are tested,
  against a fake adapter (`test/dap.test.js`, including a TCP fixture).** C#/F#/Rust were deliberately left
  out of this whole-file launch model: unlike Python/Go/Dart, none of them can launch straight from a source
  path - they need a build step first (`dotnet build`/`cargo build`) to produce the thing a debugger actually
  attaches to, which doesn't fit this feature's "Debug this file" shape. They keep the existing "Debug this
  test" lens (Settings -> a Debug lens, waits for your own IDE's debugger to attach) instead, same as PHP,
  Ruby and Scala, where no standalone DAP adapter exists at all (PHP's Xdebug speaks DBGp, a different
  protocol - writing a DBGp-to-DAP bridge from scratch was judged too large to do unverified) or no debug
  story was investigated (Scala - sbt's JVM-targeting problem, see the "Run this test" section above).
- **"Go to symbol in workspace" (Ctrl+T) has no incremental cross-reference with the LSP "exact usages" lens** -
  the workspace symbol index (tree-sitter/regex, same parser the symbol lenses use) and LSP's own usage-finding
  are separate systems; a rename doesn't refresh the symbol index until the next file-watcher pass.

## Semgrep (SQL injection / XSS coverage) — verified, narrower than "p/default" sounds
- Confirmed empirically (hand-written vulnerable Python/Flask and Node/Express samples) that the configured
  `p/default` ruleset genuinely catches real SQL injection (Flask/SQLAlchemy raw string concatenation) and XSS
  (Express `res.send`/raw-HTML-format) patterns - not just a plausible-sounding ruleset name.
- The SQL-injection half of this gap is closed: `core/semgrep-rules/generic-sql-concat.yml` (run alongside
  `p/default` by the Semgrep gate) is a small, generic taint rule (JS/TS, Python, Java) that catches a string
  built by concatenation/interpolation/formatting reaching any method whose *name* looks like it runs a query
  - regardless of ORM/driver - verified by hand against real vulnerable and safe (parameterized-query) samples
  in all three languages, including through an intermediate variable, not just an inline argument.
- The XSS half is not: a response written via a bespoke wrapper the ruleset doesn't recognize (not
  Express's own `res.send`/raw-HTML-format shapes) is still missed. Same kind of generic taint rule would
  close it, just not written yet.
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
  real `~/.claude` on a dev machine. Codex's `~/.codex/config.toml` location and tiering, and Gemini's
  `~/.gemini/settings.json` location, are now confirmed against the tools' own official docs
  (developers.openai.com and geminicli.com respectively) - Codex's `hooks.json` location specifically
  is still unconfirmed (those docs don't mention it). Copilot's global MCP file
  (`~/.copilot/mcp-config.json`) location was already right; **its key name was not** - confirmed
  against GitHub's own docs that it is `mcpServers`, not `servers` (that's `.vscode/mcp.json`'s own key,
  which the docs say the CLI explicitly does not read), so this was a real bug fixed here, not just an
  unverified guess. The CLI's actual project-level files, `.mcp.json` and `.github/mcp.json` (also
  confirmed, also `mcpServers` - or a bare, unwrapped `{name: {...}}` form), are now scanned too;
  `.vscode/mcp.json` stays, for the separate, real VS Code extension convention. Claude Code also keeps
  a *third*, project-scoped-but-personal MCP record per project inside `~/.claude.json`
  (`projects["<abs path>"].mcpServers`, confirmed on a real `~/.claude.json` - the top level has no flat
  global `mcpServers` key at all, despite that being the more obvious guess) - deliberately not surfaced
  here, since it's neither "this project's committed config" nor "applies to every project," and folding
  it into either scope would misrepresent it.
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
