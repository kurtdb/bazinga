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
