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
- Scorecard-style transparency: a small "guard overrides" panel (like the scorecard trophy) showing counts per
  rule, so you can see what you're about to be asked about before it happens.

## Session replay

- Right now commits disappear from the timeline the moment you open Review or the merge dialog (`prepareReview`
  folds them into staged changes). Consider snapshotting the commit list once, before folding, so replay stays
  available for the lifetime of the run even after you've started reviewing it.
- Inline diff preview in the replay panel itself (small side-by-side) instead of requiring a click-through to a
  separate Monaco tab — would make scrubbing feel more like actual video scrubbing.
- Keyboard shortcuts (←/→ or j/k) for stepping through, to match the prev/next buttons already there.

## Auto-merge

- An oversight-level tie-in: "Autonomous" is the natural place to default `autoMerge.enabled` on, if the user
  wants the levels to fully express this instead of it being a separate toggle.
- A "dry run" mode: log what *would* have been auto-merged (and why) without actually merging, so someone can
  build trust in the feature before flipping it on for real.
- A Fleet-dashboard indicator when auto-merge is armed for a run, so it's visible at a glance which runs might
  merge themselves.
- Per-kind-of-task control (e.g. auto-merge `docs`/`tests` but never `bugfix`), instead of one global toggle.

## Semantic diff

- Wire the "N symbol changes" summary into the **merge dialog** itself (next to the guard box), not only the
  diff viewer — that's the moment someone is deciding whether to trust the change.
- Extend the rename heuristic to **moved-across-files** renames (a function cut from one file and pasted into
  another with a new name) — currently only looked at within a single file's before/after.
- Feed the semantic-diff summary into the AI review prompt (`reviewCommand`) as extra context, so the reviewer
  model gets "renamed X→Y" instead of having to infer it from a messy line diff.

## The bigger one: a unified "safe to merge" verdict

Discussed but not built: fuse the existing quality gates, merge guard, and scorecard confidence into one
glanceable score per run — "verification, not orchestration" as the thing that sets this apart from
orchestration-focused tools (Orca and friends). Auto-merge is the first real step down this road (it already
*acts* on gates+guard+scorecard together); the natural next move is to surface that same fused judgment as a
visible badge/verdict on every run, whether or not auto-merge ever fires, so a human reviewing a run that *didn't*
qualify for auto-merge still sees the same reasoning laid out ("gates clean, but only 2 runs of this kind — here's
why it's in your queue").

## Smaller polish ideas

- A changelog entry for this batch of four features (`CHANGELOG.md` wasn't touched).
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
