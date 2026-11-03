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
