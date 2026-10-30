# Next steps

A working list of what could reasonably come next, written right after shipping adaptive guard rules, session
replay, auto-merge and semantic diff. Nothing here is committed to — it's a menu, not a backlog.

## Fix first (found while building the last batch)

- ~~**Settings dialog is index-fragile.**~~ Done: `f` is now a keyed object (`{theme: el(...), autoMerge: el(...),
  ...}`) and `TABS` uses string keys, so a new field can no longer shift anything else by accident. Verified via
  `npm test` and the settings-dialog smoke steps.
- ~~**The smoke test has a pre-existing flaky worktree-cleanup race.**~~ Root-caused and fixed: `setRoot()` in
  `src/main/main.js` now canonicalizes the path with `fs.realpathSync.native()` before storing it. On macOS `/var`
  is a symlink to `/private/var`, so a project opened via its unresolved temp-dir path and a worktree path reported
  by `git worktree list` (always canonical) didn't compare equal as strings; `project:switch`'s known-roots check
  then failed silently, leaving the active root stuck on a worktree that was about to be deleted — explaining the
  whole `ENOENT .worktrees/smoke-run/*` cascade. Smoke failures went from 35 to a handful, stable across repeated
  runs. `symbol lenses` and `spring awareness` turned out to be downstream of the `.ide/config.json` corruption
  described above, not independent bugs, and are fixed now. What is left flakes across runs rather than failing
  the same way every time: `review comments on diff lines`, `model self-test panel`, `container run`,
  `workflow editor`, `workflow: a step over its time limit`, `extra themes`. Still not investigated - worth
  their own pass, but none of it is the new-feature coverage above, which is solid across repeated runs now.
- ~~**The five flaky steps above, investigated.**~~ Four were real test bugs, not app bugs, found by running the
  real smoke suite repeatedly and reading the evidence instead of guessing:
  - `workflow editor`: looked for a button labelled `+ Add step`; the real button (`ic('plus'), 'Add step'`) has
    no literal "+", so the lookup always returned `undefined` and `.click()` threw. Fixed the lookup string.
  - `model self-test panel`: the Test button is icon + text (`ic('flask-conical'), 'Test'`), and the icon's inline
    SVG has indentation whitespace text nodes, so `button.textContent` is `"  Test"`, never the exact string
    `"Test"` the step compared against - every `=== 'Test'` filter silently returned 0 regardless of what was on
    screen. Fixed by trimming before comparing. Once trimmed, the `aider` assertion needed a second look: it
    counts Test-buttons across *all* agent rows, not just the newly-added one, and the Claude-local-model row
    added earlier in the same step keeps its Test button - so the correct expectation is that adding the Aider
    preset leaves the count unchanged (`aider === after`), not that it must be some fixed literal.
  - `container run`: the step's `text()` helper joined every xterm buffer row with `'\n'` to read back the typed
    docker command line. That line soft-wraps across rows at the terminal's width (this is zsh's own line-editor
    redraw, not plain terminal auto-wrap - xterm's `isWrapped` flag does not cover it, confirmed by trying it and
    seeing the exact same corruption), so the literal `\n` insertion was splitting words mid-wrap (`--network` →
    `--n\network`), breaking the regex checks further along the same logical line. Fixed by concatenating all rows
    with no separator at all, since the checks are plain substring-presence regexes that don't care about line
    structure.
  - `extra themes`: `monaco.editor.defineTheme('bazinga-X', { base: 'Y', ... })` makes Monaco apply the *base*
    theme's DOM class (`vs`/`vs-dark`/`hc-black`/`hc-light`) to `.monaco-editor`, never the custom theme's own id -
    confirmed by dumping the live class list for all four custom themes. The check was looking for a class Monaco
    never applies. Fixed by checking the actual rendered background color of `.monaco-editor-background` instead.
  - `workflow: steps chain through gates and approval` (the work-item-picker sub-check, `#wf-pull`) turned out to
    be a real timing issue, not a logic bug: the dialog swap is an IPC round trip (`workitems:providers` then
    `workitems:list`) that runs after ~70 earlier steps' worth of accumulated terminals/Monaco models, and 6s was
    occasionally too tight for that round trip under load - confirmed by watching the dialog title over time and
    seeing it eventually flip past the old 6s budget. Raised the wait to 12s.
  - ~~**Not reproduced as failures in several repeated full runs during this pass (so left alone for now):
    `review comments on diff lines`, `workflow: a step over its time limit`.**~~ Given another real pass: 25
    full smoke runs across this round of investigation, zero failures for either step. Whatever was destabilizing
    them is gone (most likely the same `.ide/config.json`/`checks.yaml` corruption and worktree-canonicalization
    bugs already fixed above - both steps depend on state those bugs could plausibly have clobbered). Leaving
    them as ordinary steps; no further changes made.
  - ~~**`spring awareness: route lens, implementations lens, overview` and `symbol lenses: usages + last change
    above functions and classes`, a timing-sensitive race, not confirmed.**~~ Confirmed, root-caused, partially
    fixed. Across ~28 repeated full runs: both steps fail only on the *editor-rendered-codelens* assertion
    (`shownImpl`/`shown` timing out), never on the data itself - the exact same `api.symbols.info()` call the
    step also makes directly (bypassing the editor) always returned the right answer first. So the computation is
    fine; what's unreliable is Monaco ever calling our `provideCodeLenses` and rendering the result for that
    model. Two real findings, one fixed, one still open:
    - **Fixed, and a real app bug, not just a test one:** the symbol-lens provider (`registerSymbolLenses` in
      `src/renderer/app.js`) had no `onDidChange` emitter, so if its one call to `api.symbols.info()` ever threw
      or came back with `.error` (main process busy with something else at that instant), Monaco would render
      zero lenses for that file and - since nothing told it to try again - never recompute until some unrelated
      edit happened. A real user hitting this even once would see the lenses for a file silently stay empty for
      the rest of that session, with no error anywhere. Added an `onDidChange` emitter the provider fires (with
      backoff, capped at 3 tries) after a failed attempt, plus `console.error` on every failure and a rolling
      `state.lensDebug` trace of the last 50 `provideCodeLenses` calls, so a real occurrence is now debuggable
      from DevTools instead of invisible. Also raised the editor-assertion waits in both steps from 8s to 15s
      (same reasoning as the `#wf-pull` fix above: Monaco's own codelens scheduling, not our code, is what's slow
      under load).
    - **Still open:** under genuinely heavy system load (confirmed via `top`/`vm_stat` during this investigation
      - load average 5-7, under 100MB free physical memory, a long-uptime machine with a lot else running), the
      fix above was not sufficient to make the flake disappear entirely - it still reproduced twice in the same
      batch of runs that pushed the machine hardest. The retry path's own diagnostic (`state.lensDebug`) came back
      `undefined` on that occurrence, meaning `provideCodeLenses` was never invoked for *any* file that whole
      run, not just util.py - pointing at Monaco's own CodeLens scheduling (or the `registerCodeLensProvider`
      call itself) occasionally not engaging at all under extreme load, upstream of anything this app controls.
      Not reproducible on a normal-load machine in the runs done here (0 failures in 19 of 28 runs, including a
      clean batch run right after the fix). Needs its own pass with `state.lensDebug` watched live if it's worth
      chasing further; for now the two mitigations above are a real improvement and the residual flakiness is a
      load-dependent edge case, not a correctness bug.
    - Noticed in passing, not investigated (outside this pass's scope, no code touched): `auto-merge dry run:
      logs what would have merged...` started failing in the same high-load batch (3 of the last 6 runs), with a
      stuck `events: ["checking", "done"]` / `verdictReady: false` pattern consistent with the same root cause
      (it waits on a real idle-detection → fix-loop → verdict cycle, `waitFor(..., 20000)` plus a fixed `sleep`).
      No change was made to auto-merge or verdict code during this pass; flagging it here rather than chasing it,
      since it reproduced only once the machine was already under self-inflicted heavy load from ~25 prior runs.
- ~~**No smoke-test coverage yet for the four new features themselves.**~~ Done: real end-to-end steps for session
  replay (scrubber + keyboard), adaptive guard rules (3 real overrides of a protected-path blocker via the API,
  then a 4th through the real merge dialog expecting the relax-it suggestion), semantic diff (rename detection
  via the real symbol-changes button and popup) and auto-merge (a real idle → gates-clean → auto-merge cycle).
  Along the way, found and fixed three real bugs, not just test issues:
  - `project:switch` validated the target against `runs.listRuns(requireRoot())` - the *current* root - instead
    of the target. Auto-merge removes a run's worktree while it may still be the active root (nobody switched
    away first), so this always failed with "Not a known agent run of this repository" when trying to switch
    back afterward. Now lists from the target instead. This was a real bug in the shipped auto-merge feature,
    not just the test: it would have hit anyone who had the auto-merging run open in the UI.
  - The existing "replace in files" smoke step's regex-mode case is project-wide (`(\w+)\(`) and was leaving
    `util.py`, the Java fixtures, and the *untracked* `.ide/config.json` / `.ide/checks.yaml` permanently
    mutated (reverting an untracked file deletes it) because its cleanup only restored `a.py`/`b.py`. This was
    quietly breaking agent definitions and check config for the rest of the suite, and was almost certainly the
    real cause behind the "symbol lenses" and "spring awareness" failures below, not unrelated flakiness.
  - `IdleDetector.poll()` needs `minBytes` (400) of output before it ever considers a terminal idle - a trivial
    `echo`-style stand-in agent exits (or stays silent) well under that, so the fix loop's idle → gates → merge
    path can never fire for one. Worth remembering for any future test (or real low-output agent) that expects
    the fix loop to notice it went quiet.
- ~~**No smoke-test coverage yet for the second batch either (unified verdict, guard-overrides panel, auto-merge
  dry run, the merge-dialog symbol-change count, the replay commit-snapshot fix).**~~ Done: five real end-to-end
  checks added, each reusing an existing step's fixture rather than standing up new agent runs from scratch:
  - Session replay: the existing step's two real commits are now also checked *after* a `runs:guard` call (what
    a real Review/Merge open triggers) folds them away - replay must still show both, now as non-interactive
    `commit-snapshot` rows sourced from the journal, proving the fold-survival fix actually works end to end.
  - Adaptive guard rules: the existing 4th-run mergeRunDialog check (already open to see the relax-it suggestion)
    now also asserts the fused verdict calls the same run "Blocked" (`.guard-row.verdict.block`), not just the
    raw guard list.
  - New step: renames a function inside a dedicated run's worktree and checks the merge dialog's muted
    "N symbol changes" row, proving the run-wide count (not just the per-file diff viewer's own button) is wired
    up.
  - New step, right after the real auto-merge step: the same clean docs-task run with `autoMerge.dryRun: true`
    instead - confirms it is never actually merged, that an `automerge-dryrun` journal event is written, and
    that the merge dialog still calls it "Safe to merge". Needed one real fix to the *test*, not the app: the
    merge dialog's own guard check is interactive (not `unattended`), so the usual "mark it reviewed" nudge
    correctly holds the verdict at "caution" even for a run about to auto-merge unattended - that is intentional
    (see verdict.js), so the step turns the `unreviewed` rule off for itself rather than fighting it.
  - Scorecard: the existing step's `openScorecard()` check (already open for the per-kind tables) now also
    confirms the "Guard overrides" table shows `protectedPaths` with count 3 - the exact count the adaptive
    guard rules step above already produces via real merge-API overrides, so no new fixture was needed.

## Adaptive guard rules

- Surface the same suggestion (and a way to review/reset override counts) in **Settings → Merge guard**, not only
  in the merge dialog — right now you only see it at the moment you override, never afterwards.
- Let a suggestion apply to a **project's** `.ide/config.json` instead of only the IDE-level settings, for teams
  that commit their guard policy.
- ~~**Scorecard-style transparency: a small "guard overrides" panel (like the scorecard trophy) showing counts
  per rule, so you can see what you're about to be asked about before it happens.**~~ Done: the Scorecard screen
  now has a "Guard overrides" table (rule label + times overridden, across every project), fed by the existing
  `guardoverrides.json` counts the suggestion logic already tracked - no new persistence needed.

## Session replay

- ~~**Right now commits disappear from the timeline the moment you open Review or the merge dialog
  (`prepareReview` folds them into staged changes). Consider snapshotting the commit list once, before folding,
  so replay stays available for the lifetime of the run even after you've started reviewing it.**~~ Done:
  `prepareReview` now writes each commit (subject + short sha + its own timestamp) into the run's journal as a
  `commit-snapshot` event right before the `git reset --soft` that folds them away. The journal always survives,
  so replay keeps showing them - rendered as read-only "commit"-looking rows (no click-through to a diff, since
  the per-file diff is genuinely gone once squashed into staged changes; showing it as un-clickable history is
  the honest version of this fix). Idempotent: a second Review/merge-dialog open has nothing left to fold, so it
  can't duplicate the snapshot.
- Inline diff preview in the replay panel itself (small side-by-side) instead of requiring a click-through to a
  separate Monaco tab — would make scrubbing feel more like actual video scrubbing.
- ~~**Keyboard shortcuts (←/→ or j/k) for stepping through.**~~ Already shipped (before this backlog item was
  written down) - `wrap.addEventListener('keydown', ...)` in `openReplay`. What wasn't right: `j`/`k` were wired
  backwards from the usual list convention (`j` stepped back, `k` stepped forward), the opposite of "j = down/
  forward, k = up/back" used elsewhere (vim, Gmail, …). Fixed the mapping and extended the existing smoke step to
  assert both directions for `j` and `k`, not just the arrow keys.

## Auto-merge

- An oversight-level tie-in: "Autonomous" is the natural place to default `autoMerge.enabled` on, if the user
  wants the levels to fully express this instead of it being a separate toggle.
- ~~**A "dry run" mode: log what *would* have been auto-merged (and why) without actually merging, so someone
  can build trust in the feature before flipping it on for real.**~~ Done: `autoMerge.dryRun` (Settings →
  Agents, next to the win-rate field). When on, `tryAutoMerge` computes the same verdict it always would and,
  if eligible, writes an `automerge-dryrun` journal event plus a notification instead of actually merging.
- A Fleet-dashboard indicator when auto-merge is armed for a run, so it's visible at a glance which runs might
  merge themselves.
- Per-kind-of-task control (e.g. auto-merge `docs`/`tests` but never `bugfix`), instead of one global toggle.

## Semantic diff

- ~~**Wire the "N symbol changes" summary into the merge dialog itself (next to the guard box), not only the
  diff viewer — that's the moment someone is deciding whether to trust the change.**~~ Done: a muted row above
  the guard list shows the total symbol-change count summed across every changed file in the run (not just the
  one open in an editor tab), computed by a new `symbolChangesForRun` helper that reuses the same
  tree-sitter/regex symbol parsing the per-file diff viewer already uses.
- Extend the rename heuristic to **moved-across-files** renames (a function cut from one file and pasted into
  another with a new name) — currently only looked at within a single file's before/after.
- Feed the semantic-diff summary into the AI review prompt (`reviewCommand`) as extra context, so the reviewer
  model gets "renamed X→Y" instead of having to infer it from a messy line diff.

## ~~The bigger one: a unified "safe to merge" verdict~~

Done. `src/core/verdict.js` fuses the merge guard, the scorecard's track record for this (agent, kind), and the
auto-merge win-rate bar into one of three levels - `blocked` (guard has blockers), `caution` (guard clean or
only warnings, but not auto-merge-eligible) or `ready` (would actually auto-merge) - each with a plain-language
detail string. It deliberately reuses `automerge.autoMergeEligible` rather than reimplementing the eligibility
rule, forcing `cfg.enabled = true` internally just to get the real underlying reason instead of the generic
"auto-merge is off" short-circuit. Shown as a line above the guard list in the merge dialog on every run,
whether or not auto-merge is actually on for the project; `tryAutoMerge` itself now reuses this same verdict
instead of computing eligibility a second time.

## Smaller polish ideas

- ~~**A changelog entry for this batch of four features (`CHANGELOG.md` wasn't touched).**~~ Done: `Unreleased`
  now covers the unified safe-to-merge verdict, auto-merge dry run, the guard-overrides panel, the merge-dialog
  symbol-change count, the session-replay commit-loss fix, and the Codex/Gemini/Aider presets.
- ~~**Screenshots didn't show the four new surfaces, and were never actually committed.**~~ Done, and it was two
  separate bugs: `.gitignore`'s `screenshots/` pattern was unanchored, so it matched `docs/screenshots/` too —
  every image the README embeds was gitignored and had never once been committed (404 on GitHub since the repo
  existed); fixed to `/screenshots/` (root-only; that's the real scratch output dir `npm run screenshots` writes
  to with no destination argument). Added scenarios 16-19 (session replay, adaptive guard rules, semantic diff,
  auto-merge) to the screenshot driver in `app.js`; scenario 17 surfaced a real ordering bug of its own - step 12
  (folder roles) writes the "src" mark straight into the tracked `.ide/config.json` without committing it, which
  left main dirty and made every later `api.runs.merge` call in the new scenario fail silently (`{error}`, not
  thrown) for lack of a `.error` check, so the three scripted overrides never got recorded and the suggestion
  never appeared - fixed by committing that change first and by checking `mres.error` so a future failure here
  fails loudly instead of quietly producing a wrong screenshot. Regenerated all 19 dark and light screenshots via
  `npm run screenshots` / `BAZINGA_THEME=light npm run screenshots -- docs/screenshots/light`; README table and
  `scripts/screenshots.js`'s 180s timeout (now 300s - the new scenarios add several more runs and real merges)
  updated to match.
- `recordOutcome(base, run, outcome)`'s `base` parameter is unused in its body (pre-existing oddity, noticed while
  reading around it for auto-merge) — harmless, but worth a look next time that function is touched anyway.

## ~~Custom themes, generated from three seed colours~~

Done. Considered converting theming wholesale to VS Code's workbench-colour/tokenColors model first, so people
could load a real VS Code theme; ruled out — no clean 1:1 mapping onto bazinga's own ~20-variable palette and
chrome, and most of a VS Code theme (tokenColors) only matters for syntax highlighting, which was never the ask.
Landed the narrower, native version instead: Settings → General → "Create custom theme…" takes background/text/
accent and derives the rest (surfaces, muted/faint text, err/warn/ok/info, the commit-graph lanes, badge fills)
via `src/core/custompalette.js`, nudging every text-role colour in lightness only (hue/saturation left alone)
until it clears the same 4.5:1 bar `test/theme.test.js` holds the built-ins to, or as close as that hue can
reach — shown in a live summary. An expandable "fine-tune" section overrides any generated variable by hand
afterwards. `src/core/contrast.js` now holds the WCAG math shared by `theme.test.js` and the new module, instead
of each having its own copy.

The one real wrinkle: the renderer is fully sandboxed (`contextIsolation: true, nodeIntegration: false`), so it
can't `require()` `custompalette.js` directly the way a test file can — derivation runs in the main process,
reached over two new IPC calls (`theme:derive`, `theme:contrast`). Cheap enough to call on every colour-picker
`input` event behind a ~120ms debounce; felt live in manual testing.

Unlike every built-in theme, a custom one has no `:root[data-theme="..."]` block in `styles.css` at all — its
~27 variables are set as inline styles on `<html>` at runtime instead (`applyCustomVars()` in `app.js`), which is
why `applyTheme()` now always clears them first: inline style beats the attribute-selector CSS, so a stale
override would otherwise leak into whichever built-in theme got picked next. Deliberately never added a
`:root[data-theme="custom"]` CSS block either, specifically so `theme.test.js`'s CSS-block-discovery-based
schema-enum-matching test needed no change at all - a custom theme simply never shows up in that discovery.
Stored IDE-wide in `settings.customThemes` (not project-shareable - a theme is a personal preference), each
entry keeping both its seed and its resolved `vars` so "Edit" can reopen the picker pre-filled.
Verified with `test/custompalette.test.js` (a spread of dark/light/saturated/desaturated/already-failing seed
colours) plus a new smoke step that builds a theme via the real `api.theme.derive` + `api.settings.save` path
(no UI automation) and checks it actually paints the shell, Monaco and the terminal, and leaves nothing behind
once you switch to a built-in theme afterwards.

## ~~Coding font picker~~

Done. Settings → General → Font, next to the existing editor/terminal size fields. Five alternatives alongside
the existing default (Roboto Mono): JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono —
all OFL-1.1, all on `@fontsource` with the same `latin-400`/`latin-700` weight-file split Roboto Mono already
used, so each adds only two small linked CSS files (confirmed via `npm pack`, tens of KB per font).

The one thing worth a new design was making `MONO` (`app.js`) a mutable `let` instead of a `const`: Monaco's and
xterm's creation-time options already reference it by variable name, so once `applyFonts()` (renamed from
`applyFontSizes()`, which it now also is) reassigns it and sets `--font-mono`, every editor and terminal created
afterwards picks up the new font with no extra special-casing, and every one already open gets its `fontFamily`
option and `--font-mono` updated directly, including re-fitting each terminal (`entry.fit.fit()`) since cell
width changes per font. `loadFonts()` preloads all six fonts' weights upfront (it runs before the saved setting
is even read), which costs nothing since they're all bundled already.

Also pointed the Nerd theme's `--font-ui` (its whole "monospace everywhere" identity) at `var(--font-mono)`
instead of a hardcoded Roboto-Mono-flavoured stack, so it now follows whichever font is picked.

Verified by extending `test/theme.test.js` (each font linked in `index.html` and installed under
`node_modules/@fontsource/`, and the schema enum matches) plus a new smoke step that switches the font via the
real Settings dialog and checks the editor, every open terminal and `--font-mono` all picked it up together, and
that it survives a reload.

## Go, Rust and C# - quality gates and language servers (first slice)

Started on request. Before this, the three languages already had real support in several places - tree-sitter
symbols/outline (`treesitter.js`, wasm grammars already vendored), usages/blame lenses, guard-rule file patterns,
duplicate-code matching, folder-role detection, and `LSP_LANGUAGE_ID`/`MONACO_LANGUAGE` mappings in `lsp.js` - but
two pieces were genuinely missing, matching Java/Python's level of support:

- **Quality gates** (`src/core/defaults.js`): `Go vet` (fast - built into the toolchain, so no extra install),
  `Go build`/`Go test` (slow); `Cargo check`/`Cargo clippy` (fast - clippy via its own `cargo-clippy` binary,
  installed by `rustup component add clippy`), `Cargo test` (slow); `.NET build`/`.NET test` (slow). `Go
  vet`/`Go build` and `.NET build` parse real file/line from the tool's own output via the existing `regex`
  parser (no new parser code, just a pattern); Cargo's two needed a new `cargo` parser (`src/core/parsers.js`) for
  its `--message-format=json` newline-delimited JSON stream. `Go test`/`Cargo test`/`.NET test` report pass/fail
  with the output tail only (`exitcode`), the same level of detail Vitest already gets - none of the three has
  an always-installed structured test report the way Maven Surefire does, and chasing one (a TRX logger for
  dotnet, `cargo-nextest` for junit XML, Go's own `-json` test stream) felt like a separate, optional step rather
  than part of a first slice. Decided against shipping `golangci-lint` as a default gate: its JSON output format
  changed between v1 and v2, `go vet` already gives a real, zero-install fast gate, and Semgrep (now also matched
  against `*.go`/`*.rs`/`*.cs`, previously JS/Python/Java/shell/YAML only) covers generic cross-language rules for
  the three anyway. Verified end to end with a throwaway repo containing a `go.mod`+`.go`, `Cargo.toml`+`.rs` and
  `.csproj`+`.cs` file (none of the three toolchains is installed on this machine) - all eight gates reported
  `skipped: <tool> is not installed` cleanly, same as a missing Maven/Pyright does, instead of throwing.
- **Language servers** (`src/core/lsp.js`'s `DEFAULT_SERVERS`, mirrored in Settings → Editor's `LSP_DEFAULTS` in
  `app.js`): `gopls`, `rust-analyzer`, `csharp-ls` alongside the existing jdtls/pyright/typescript-language-server
  presets. Nothing bundled, same as the other three - opt-in, found on PATH.

Not done yet, and a reasonable next slice: the "Run this test" / "Run all tests in this file" code lenses
(`src/core/testcmd.js`) only know Java/JUnit, JS (Vitest/Jest/node:test) and pytest - Go (`go test -run
'^Name$'`), Rust (`cargo test name`) and C# (`dotnet test --filter FullyQualifiedName~Name`) would need their own
test-boundary line patterns and command-building branches there, separate from the quality-gate work above.
