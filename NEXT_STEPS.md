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
