# Next steps

A working list of what could reasonably come next. Nothing here is committed to — it's a menu, not a backlog.
Finished work lives in `CHANGELOG.md` and git history, not here, so this file stays short: when something below
is done, delete it rather than leaving a struck-through retrospective in its place.

## Flaky under heavy load only, not reproduced under normal conditions
Both noticed during a long back-to-back smoke-run investigation (20-25+ runs, load average 5-7, <100MB free
memory) and not seen since under normal load. Worth a look only if either recurs in practice:
- Monaco's own CodeLens scheduling occasionally not engaging at all for an entire run (not just one file) -
  `registerCodeLensProvider`'s callback never firing. `state.lensDebug` (a rolling trace of the last 50
  `provideCodeLenses` calls) is already in place to help diagnose a real recurrence.
- The auto-merge dry-run smoke step once saw a stuck `events: ["checking", "done"]` / `verdictReady: false`
  pattern, consistent with the idle-detection → fix-loop → verdict cycle timing out under self-inflicted load.

## Smaller polish ideas
- `recordOutcome(base, run, outcome)`'s `base` parameter is unused in its body (pre-existing oddity) — harmless,
  but worth a look next time that function is touched anyway.

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
