# Next steps

A working list of what could reasonably come next. Nothing here is committed to — it's a menu, not a backlog.
Finished work lives in `CHANGELOG.md` and git history, not here, so this file stays short: when something below
is done, delete it rather than leaving a struck-through retrospective in its place.

## Adaptive guard rules
- Surface the same suggestion (and a way to review/reset override counts) in **Settings → Merge guard**, not only
  in the merge dialog — right now you only see it at the moment you override, never afterwards.
- Let a suggestion apply to a **project's** `.ide/config.json` instead of only the IDE-level settings, for teams
  that commit their guard policy.

## Session replay
- Inline diff preview in the replay panel itself (small side-by-side) instead of requiring a click-through to a
  separate Monaco tab — would make scrubbing feel more like actual video scrubbing.

## Auto-merge
- An oversight-level tie-in: "Autonomous" is the natural place to default `autoMerge.enabled` on, if the user
  wants the levels to fully express this instead of it being a separate toggle.
- A Fleet-dashboard indicator when auto-merge is armed for a run, so it's visible at a glance which runs might
  merge themselves.
- Per-kind-of-task control (e.g. auto-merge `docs`/`tests` but never `bugfix`), instead of one global toggle.

## Semantic diff
- Extend the rename heuristic to **moved-across-files** renames (a function cut from one file and pasted into
  another with a new name) — currently only looked at within a single file's before/after.
- Feed the semantic-diff summary into the AI review prompt (`reviewCommand`) as extra context, so the reviewer
  model gets "renamed X→Y" instead of having to infer it from a messy line diff.

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
