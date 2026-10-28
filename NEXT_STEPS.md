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
  - Not reproduced as failures in several repeated full runs during this pass (so left alone for now):
    `review comments on diff lines`, `workflow: a step over its time limit`.
  - A flake not on the original list turned up repeatedly across several more rounds of full runs (done while
    verifying the five fixes above, and again while adding Codex/Gemini/Aider support below): `spring awareness:
    route lens, implementations lens, overview` and `symbol lenses: usages + last change above functions and
    classes`, never both in the same run, each failing differently each time (`shownRoute: null` one run,
    `shownImpl: null` another, `symbol lenses` returning a bare `FAILED` with no detail another) and otherwise
    passing cleanly. Given these two were already linked to one shared root cause before (see above - the
    "replace in files" cleanup bug), this looks like the same pairing resurfacing as a timing-sensitive race
    rather than two new independent bugs, but that is a hypothesis, not confirmed - worth its own real pass
    (reproduce it enough times to see the actual corrupted state, don't guess).
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
