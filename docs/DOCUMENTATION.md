# Bazinga — full documentation

Everything below the TL;DR in [`README.md`](../README.md): install, every feature in detail, configuration, CI integration, local models, known limits, layout and theming.

## Install (Windows and macOS)

Prerequisites: [Node.js](https://nodejs.org) 20+ (22 recommended) and [Git](https://git-scm.com). On macOS the commands are the same (`npm start -- ~/path/to/project`).

```powershell
cd bazinga
npm install
npm start -- C:\path\to\your\project
```

Without a path it reopens the last project, or shows an *Open folder* button.

`npm install` downloads Electron from GitHub. Behind a corporate proxy set `HTTPS_PROXY` first, or point `ELECTRON_MIRROR` at an internal mirror. The terminal backend (`node-pty` 1.1) ships a prebuilt Windows binary, so no compiler is needed.

## Windows and macOS builds from GitHub

`.github/workflows/build.yml` runs on every push and pull request:

1. **Test** on Linux, Windows and macOS (`npm test` plus the headless app smoke test). Linux must pass; Windows/macOS failures are shown but don't block step 2, so you can see what needs fixing without losing the build.
2. **Build** on a Windows and a macOS runner. The results are downloadable from the run's *Artifacts* section (Actions tab): `bazinga-windows` (installer + portable `.exe`) and `bazinga-macos` (`.dmg` and `.zip` for Apple Silicon and Intel).
3. Pushing a tag like `v0.2.0` also creates a GitHub **Release** with those files.

**Building on your own computer** (`npm run dist:mac`, `npm run dist:win`):

- Both go through `scripts/dist.js`. Without a `.git` folder (a downloaded zip) electron-builder cannot find the GitHub repository for the update feed and used to fail at the very end (`Cannot read properties of null (reading 'channel')`); now such a build simply has no update feed. Built from a clone of your GitHub repository, the feed is included.
- A local macOS build is signed and notarized the same way the CI build is (see *Unsigned apps* below) by exporting the same six variables in your own shell before running `npm run dist:mac` — electron-builder reads them from the environment either way, CI or not.
- **Windows installer from an Apple Silicon Mac** needs Rosetta, because the NSIS tool is an Intel program (`spawn Unknown system error -86` means it is missing): run `softwareupdate --install-rosetta --agree-to-license` once, then build again. Or let the GitHub workflow build it on a Windows runner (above), which needs nothing installed.
- Not tested here: the Windows and macOS builds themselves (only the Linux build and the packaging step were).

Works in a private repository. Things to know:

- **Cost:** private repos have a monthly free-minutes quota; macOS minutes count 10x and Windows 2x. A build is a few minutes per platform, so occasional builds are fine, building on every push is not. Change `on:` to `workflow_dispatch` plus tags if you want builds only on demand.
- **Unsigned apps:** Windows shows a SmartScreen warning (*More info → Run anyway*). The macOS build is ad-hoc signed, so Gatekeeper blocks it the first time: right-click the app → *Open*, or run `xattr -cr "/Applications/Bazinga.app"`. An ad-hoc-signed build also cannot auto-update itself (`core/updater.installBlocker`); download the new version from the releases page instead.
  A signed and notarized build needs an Apple Developer account (99 USD/year), then six repository secrets (Settings → Secrets and variables → Actions on GitHub) — the build step already picks all of them up with no further config:
  - Open Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority, upload the request at [developer.apple.com](https://developer.apple.com/account/resources/certificates) to get a *Developer ID Application* certificate, install it, then export it from Keychain Access as a `.p12` (with a password). `MAC_CERT_P12`: `base64 -i YourCert.p12 | pbcopy`. `MAC_CERT_PASSWORD`: the export password.
  - `APPLE_TEAM_ID`: on the certificates page above, or under *Membership*. `APPLE_ID`: your Apple ID email. `APPLE_APP_SPECIFIC_PASSWORD`: generate one at [appleid.apple.com](https://appleid.apple.com) → *Sign-In and Security* → *App-Specific Passwords* (not your Apple ID password — that would fail notarization).
  All six present → electron-builder signs with hardened runtime and notarizes automatically (`@electron/notarize`, triggered by `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` being set — see `app-builder-lib`'s `MacTargetHelper.getNotarizeOptions`). Only `MAC_CERT_P12`/`MAC_CERT_PASSWORD` set, no Apple ones → signed but not notarized, which Gatekeeper still blocks on first launch. None set → ad-hoc, as today.
- **macOS specifics already handled:** the app asks your login shell for its PATH at startup (apps started from Finder don't see Homebrew, nvm or `claude`), terminals start as login shells (zsh), shortcuts use Cmd (⌘S, ⌘P, ⌘⇧F; Ctrl+C in a terminal stays the interrupt), and there is a standard app menu. Install ripgrep with `brew install ripgrep` for faster search.
- **Not verified here:** I could only test on Linux. The Windows and macOS builds have never been run by me, so treat the first CI run as the real test.

## Setup & health (start here when something does not work)

Command palette → *Setup & health* (or click **⚠ Setup: n to fix** in the status bar, which only appears when something you use is not working). One row per capability, each with a light, a sentence in plain words and, when there is something to do, one button:

- **Claude Code**: found or not, with the install command to copy.
- **Local models**: Ollama running? Is the model your agent uses downloaded? (with the command to copy); does your LM Studio / llama.cpp / vLLM server answer?
- **Safer runs (Docker)**: build the agent image with one click, then switch it on for all runs.
- **Claude Code reports itself** (hooks), **smarter task recognition** (Jev, with a field for the key), **check before you push** (git hook), the Claude Code **version watch** and **recording traffic shapes** (for bug reports) under *More*.
- *Tools on this computer* lists git, Java, Maven, etc. as before.

A first-run **walkthrough** (also in the command palette) picks your agent, shows which ones are ready, and starts a harmless first run that only explains the project. A small **?** next to the main settings headings and run-dialog fields explains them in one or two sentences.

Tested with fakes and a real Electron smoke run; not yet with someone seeing it cold, which is the real test.

## Using it

| Where | What |
|---|---|
| Top bar **Claude / Copilot / Codex / Gemini** | Opens a terminal and starts `claude` / `copilot` / `codex` / `gemini`. Edit the list in `.ide/config.json`. |
| **Changes** tab | Files changed in git (M modified, A added, U untracked, D deleted). Click for a diff. |
| **Fast checks** | Runs the cheap gates on changed files (lint, type check). |
| **All checks** | Adds the slow gates (compile, tests, Semgrep, Pyright). |
| **Auto** | Re-runs the fast gates ~1s after files change on disk, i.e. right after the agent writes. |
| Problems panel | Click a finding to jump to the line. **Copy for agent** / **Send to terminal** hand the findings to Claude as a prompt (pasted, not submitted). |
| **Scripts** tab | Your commands from `.ide/scripts.yaml`, each in its own terminal tab. |
| File tree, right-click | New file / New folder, Rename, Duplicate, Delete, Copy relative path, on top of the source/test folder marking below. Right-click empty space for the project root. Every rename/delete snapshots the old content to local history first, so it can be undone even for files git never tracked. |
| **Search** tab | Find across the project (case-sensitive, regex); a second field below replaces every match in every file the search found, with one local-history snapshot per changed file. |
| `Ctrl+S` / ``Ctrl+` `` (⌘S on macOS) | Save / new terminal. Terminal: `Ctrl+C` copies when text is selected, `Ctrl+V` pastes. |

The editor is Monaco with syntax highlighting for Java, Python, TypeScript/JS, YAML, shell, XML and more. It deliberately has **no** language server: completion, refactoring and "go to definition" are left to the agent, and correctness comes from the gates below.

## Working with agent output

| Feature | How |
|---|---|
| **Only my changes** | Problems panel checkbox (on by default). Findings on lines the agent did *not* touch (per `git diff -U0 HEAD`) are marked legacy and hidden, so old debt doesn't drown new issues. Project-scope gates (compile, tests) are never hidden. `ide-check` does the same; `--all-findings` disables it. |
| **Revert / stage / commit** | Changes tab: *Stage all*, commit box, per-file stage and revert. In a diff: **Revert this change** (the change under the cursor, then Ctrl+S), **Stage file**, **Revert file**. |
| **Checkpoints** | *Checkpoint* button, and automatically before an agent terminal starts (setting `autoCheckpoint`). Stored as commits under `refs/bazinga/checkpoints/` without touching your branch or index. *Restore* first saves a safety checkpoint. Staged state is not restored. Last 50 are kept. |
| **Cancel** | The Run button turns into Cancel; the whole process tree is killed (taskkill /T on Windows). |
| **AI review** | *AI review* pipes the diff plus the current findings to `reviewCommand` (default `claude -p ...`) and shows the answer in the Review tab. This sends your code to whatever that command talks to. |
| **Quick open / search** | `Ctrl+P` fuzzy file open, `Ctrl+Shift+F` project search (uses `rg` if installed, e.g. `winget install BurntSushi.ripgrep.MSVC`; otherwise a slower JS fallback), with a **Replace all** field that rewrites every match, in every file it was found in. |
| **Semantic diff** | Any diff view (Changes tab, a commit, local history, replay) shows a *N symbol changes* button in the diff toolbar when classes/methods/functions were added, removed, renamed or moved — a renamed function shows as **Renamed**, not as a deleted old name plus an added new one. Click it for the list, click an entry to jump there. Built from the same parser as the code lenses (tree-sitter, falling back to line patterns for languages it does not cover); a rename is only ever claimed when the body is identical once its own name is blanked out on both sides, so a rename that also changes behaviour shows as a plain remove + add instead. |
| **Settings / session** | The gear opens shell, agents, review command, auto-check. Open tabs, layout, toggles and plain terminals are restored per project. Settings are user-level (not written into the repo); `.ide/config.json` overrides them. |

## Agent runs (parallel agents, one review each)

**Agents** tab → **New agent run…**: type the task, pick the agent, optionally limit the scope, press Start.

- The IDE creates a **git worktree and branch** (`agent/<name>`) from your current commit, in `<repo>.worktrees/<name>` next to your repository, starts the agent in a terminal there and gives it the task as its first prompt. Your own working tree is never touched, so you can start several runs at once.
- Each run has **Review** (switches the whole IDE to that worktree: Changes, diffs, quality gates, scope flags, reviewed ticks, AI review all work as usual), **Terminal**, **Merge…** and **Discard**. Terminals keep running while you switch between runs.
- If the agent commits by itself, Review folds those commits back into staged changes on top of the starting commit, so everything shows up in one place.
- **Merge** squashes the run into your current branch as one commit with your message (or a normal merge commit if you untick *Squash*), then deletes the worktree and branch. It needs a clean main working tree and rolls back completely on conflicts. **Discard** deletes everything.
- The task is passed to Claude Code as `claude "<task>"` (through an environment variable, so quoting is not a problem). Other agents: set `taskCommand` in the agent's config, with `{task}` where the prompt goes (the default for Copilot is `copilot -i {task}`, for Codex `codex {task}`, for Gemini `gemini -i {task}`; check your version with `copilot --help` / `codex --help` / `gemini --help`). An agent without one (Aider, by default) gets the task pasted into its input box instead, which you confirm with Enter.
- Untracked project config (`.ide/`) is copied into each worktree. Dependencies are not: set `"runLinkDirs": ["node_modules"]` in `.ide/config.json` to link them (shared with your main checkout), or run the install in the worktree.
- Limits: every run needs at least one commit in the repository; runs are separate checkouts, so a long-running dev server or database is shared by all of them.

## Scorecard and hand-over (which agent for which task)

The scorecard also shows the **cost per merged run** per agent and kind of task: what the agent cost (from its own telemetry; an estimate from your `fleet.prices` when only tokens are known), failed attempts included, divided by the merged runs. Local models show *free*; a cloud agent that reported no numbers shows *?*, not free.

**Scorecard.** The trophy button in the Agents pane. Every time you merge or discard a run, one line is added (kept on your machine, across projects, last 500): the agent, the kind of task, and what you did with the result. The kind comes from simple keywords in the task text (tests, bug fix, refactor, new feature, docs, review/explain; anything else is "other"). Per agent and kind you see how often it got merged *alone*, how often a stronger agent had to take over, how often it lost a best-of comparison, how often you threw it away, how many runs were clean the first time under the fix loop, and the typical working time. Rows under 3 runs are faded: too few to trust. When there is enough data, the New agent run dialog says what your own history favours for the kind of task you typed and offers to pick that agent. Runs thrown away before the agent did anything are not counted. Merge and discard are only a proxy for "good": a merge after heavy hand edits still counts as a win.

**Hand-over (escalation).** In Settings → Fix loop: *Still failing after N rounds? Hand the run over to [agent]*. When the first agent has not got the gates clean after N fix rounds (or the loop would give up because nothing changes), the named agent starts in the same working copy of the run, with the task, what was changed so far (it is told to read `git diff` first) and the remaining problems. It happens once per run. Workflow steps and runs started for comparison or best-of never hand over, so those comparisons stay fair. The first agent stays open but idle. The scorecard counts such a run as "needed help" for the first agent. A cloud agent costs money: choosing it here is the decision to spend it. Project-level: `fixLoop.escalate: { "agent": "Claude", "after": 2 }` in `.ide/config.json`.

## Marking source and test folders

Right-click a folder in the file tree: *Mark as source folder*, *Mark as test folder* or *Clear mark* (the current mark is ticked). Marked folders get a small `SRC` or `TEST` badge, and everything inside shows it in its tooltip. *Detect source and test folders* (also in the command palette) marks the conventional ones that exist and are not marked yet: `src/main/java|kotlin|scala`, `src/test/java|kotlin|scala`, `src` (when there is no `src/main`), `test`, `tests`, `__tests__`, `spec`. A folder has one role; the most specific marked folder wins (a test folder inside a source folder is a test folder); the project root itself cannot be marked.

The marks are saved in the project's `.ide/config.json` (`"folders": { "source": ["src/main/java"], "tests": ["src/test/java"] }`), so they are committed and shared with the team; other keys in that file are left alone, and a file that is not valid JSON is never overwritten. The model is told in two places:

- **The standing instructions** of every Claude Code agent (the file passed with `--append-system-prompt-file`, which the slim local-model prompt keeps): *“Project layout (folders the user marked in Bazinga…) – Source code: … – Tests: … Production code belongs in the source folders and tests in the test folders; mirror the path of the code under test…”*. Only folders that still exist are mentioned. An agent that is already running keeps the instructions it started with: marks apply from the next start.
- **A managed block in AGENTS.md** (`bazinga:folders`), for agents that read that file instead (Copilot, Codex, Aider, OpenCode…). It sits next to the skills block and only the text between its markers is touched; it is removed again when the last mark is cleared. Switch it off with `"foldersIndex": false` in `.ide/config.json`.

- **The exact file names.** The standing instructions also list the code files inside the marked folders (up to 60 lines, `foldersFiles` in `.ide/config.json`, `0` switches it off; skipping `node_modules`, `target`, `build`, `.venv` and the like; with more files than that, one line per folder with its file count instead), so the model uses real paths instead of guessing or searching. The AGENTS.md block lists only the folders, so it does not change with every new file.
- **Paths are corrected for local models** (the tool-call helper, *Repair tool calls* on): when a model reads or edits `pipeline.py` and that name does not exist as given, the helper looks in the marked folders and uses the file if there is exactly one (`edgy/pipeline.py`); with two candidates it leaves the path alone and lets the tool report the error. A new file named like a test (`test_x.py`, `x_test.go`, `XTest.java`, `x.spec.ts`) without a folder goes into the marked test folder, when there is exactly one. A path with a folder in it is never moved. Every correction shows under *Behind the scenes* (`file_path pipeline.py → edgy/pipeline.py (found in a marked folder)`). The marks are read from the working folder's `.ide/config.json` on every request, so a change applies at once, also in a run's worktree.

Not yet used: the merge guard, the “tests added” gate and the related-tests lookup still recognise test files by name patterns (`*Test.java`, `test_*.py`, a `tests/` folder…), not by your marks.

## Oversight levels, guards and skills

**Human in the loop** (Settings → *Human in the loop*, or `"oversight"` in `.ide/config.json`; the project level wins over the IDE level, and the status bar shows which one is in force). A level is a preset for the fix loop, the merge guard, notifications and a task prefix; values you set explicitly in the same file still win over the preset.

| Level | What it does |
|---|---|
| Autonomous | fix loop with related tests; blocks only errors, weakened tests and protected files |
| Supervised | fix loop; you review before merging |
| Guided | no fix loop; the agent first writes a plan and waits for you; every file must be reviewed; scope, gates-not-run, bugfix-without-test and dependency changes block |
| Step by step | as Guided, plus small steps with a stop after each one; the strictest guard |

**Merge-guard rules** (each `block`, `warn` or `off` in Settings or `mergeGuard` in `.ide/config.json`): gate errors, tests deleted or weakened, scope, unreviewed files, summary, gates not run, plus:

- `protectedPaths` (default **block**): `.env*`, CI workflows, keys, Dockerfiles ... Override the list with `"protectedPaths": ["db/**", "*.sql"]`.
- `bugfixTest` (warn): the task or branch looks like a bugfix, source changed, but no test was added or touched.
- `dependencies` (warn): `pom.xml`, `build.gradle`, `package.json`, lockfiles ... changed.
- `testsImmutable` (**off**): existing unit/integration tests may not be edited, renamed or deleted at all (new test files are fine). Turn it on when the agent should only add tests.

**The guard in CI** (`bin/ide-guard.js`, `bazinga guard`, also `npm run guard`; `--comment` puts the result on the pull request, see *Command line*): the same rules (protected paths, immutable and weakened tests, bugfix without a test, dependency changes) evaluated on a branch against its target, so a pull request is blocked whatever tool made the change. Run `node scripts/export-guard.js <repo>/tools/bazinga` once to copy the standalone guard (8 files, no npm install) into the repository, then use `examples/azure-pipelines.bazinga-guard.yml` as a build validation (or the GitHub Actions twin). Output formats: `text`, `json`, `azure`, `github` (annotations); `--strict` fails on warnings too; exit 1 means blockers, 2 means it could not compare (shallow checkout?).

Shared policy: `.ide/policy.json` is a **floor** committed with the project, e.g. `{ "oversight": "supervised", "mergeGuard": { "testsImmutable": "block" }, "protectedPaths": ["db/**"] }`. `.ide/config.json` and your IDE settings can make the guard stricter, never looser; the IDE and the CI check both apply it. In CI the floor is read from the **target branch**, so a pull request cannot relax it by editing the file, and editing `.ide/policy.json` is itself a protected-path change. Rules that need a person at the IDE (reviewed ticks, the agent’s summary, scope allowlist, local gates) are skipped in CI.

**Workflows** (Agents tab → *Workflow…*, or the palette): chain agent runs with gates and approvals. **Which model runs a step**: the Start dialog has a *Default agent / model* (it starts as the agent you used last) and a selector per step; a step you leave on *Default agent* uses the default. Order of precedence: chosen for that step when starting, then the `agent:` in the workflow file, then the default, then the agent you used last, then the first one. A step whose `agent:` no longer exists falls back the same way, with a message. **Checks** (gates) per step: none, a test must be added, existing tests untouched, the merge guard, *the agent must have changed files*, and *files changed and existing tests untouched* (used by the built-in refactor workflow, so an agent that only talks and changes nothing is sent back once instead of passing). **When a step does not seem to finish**: a step whose terminal has printed nothing for 90 seconds is treated as finished even if the idle detector missed it, the card shows when Bazinga saw the agent go quiet (`quiet 20:41`), and a failing fix loop no longer keeps the IDE from hearing that the agent stopped. a running step has a *Done* button that checks its gate and goes on (use it when the agent has stopped but the workflow did not notice), and a *looks like a question* chip when the agent’s last message resembled a permission question, which pauses the workflow until you answer it or press *Done*. The Start dialog and the Agents tab draw each workflow as a small graph (steps as boxes, arrows for “starts after”; on a running workflow the boxes are coloured by state). Build one with a form: *Workflow…* → *New workflow…* (name, steps with plain-language choices for the check and the approval, “starts after” ticks, reorder with arrows; mistakes are shown as you type), or *Edit / copy…* on an existing one (built-ins open as a copy). Under the hood a workflow is a small YAML file you can also edit or review by hand: built-ins (fix a bug test-first with a separate review step, refactor with frozen tests), your own in `.ide/workflows/*.yaml` (committed with the project) or in the `workflows` folder of the IDE’s data folder.

```yaml
name: Fix bug with review
steps:
  - id: reproduce
    task: "Write a failing test for: {input}"
    gate: tests-added        # none | guard | tests-added | tests-untouched
  - id: fix
    needs: [reproduce]       # continues in the same worktree when it has exactly one dependency
    task: "Make the failing test pass. Do not change existing tests."
    gate: guard              # the merge guard must have no blockers
    retries: 1               # on a failed gate the findings go back to the agent, then it stops
  - id: review
    needs: [fix]
    agent: Copilot           # a different agent as reviewer
    task: "Review the diff against REVIEW.md. Do not change files."
    approval: human          # waits for your Approve button
```

A step starts when the steps it needs have passed; independent steps get their own worktrees and run in parallel. When a step’s agent goes quiet its gate is checked: a passed gate moves on (or waits for you with `approval: human`, which Guided and Step-by-step levels add to every step), a failed one is sent back to the agent up to `retries` times and then stops the workflow with *Retry* and *Skip* buttons. Max 12 steps, no loops. Container runs, the scrubbed environment, the time budget and the journal apply to every step. State is kept in the repository’s `.git` folder and survives a restart (a step whose terminal is gone shows *Retry*). Limits: without hooks the idle detection that triggers the gate is a heuristic (an agent that pauses for a long time mid-task can trigger an early check, which then fails the gate and costs a retry), and merging the resulting runs stays a manual step.


**Claude Code tells Bazinga when it is done (hooks).** For every Claude Code agent Bazinga adds `--settings <file>` whose hooks (Stop, Notification, UserPromptSubmit; type `http`) post to a small server on `127.0.0.1` (random port, a random token per agent, nothing else is accepted). *Stop* means the agent finished responding, so a workflow step checks its gate at that moment instead of after 8 seconds of silence; *Notification* with a permission prompt shows “needs your approval”. The quiet-terminal guess stays as a fallback and waits much longer once hooks work (a hooked step falls back to the stall check only after 5 minutes). Settings → *Claude Code reports when it is done (hooks)* turns it off. `NO_PROXY=127.0.0.1,localhost` is set for the agent so a company proxy does not swallow the call. Not verified against a real Claude Code: whether your version honours `http` hooks passed through `--settings`. The Debug tab’s *Hooks* filter shows every hook event, so you can see at once whether they arrive; if they do not, nothing is lost, the old guess is used.

**Unattended steps (`claude -p`).** A workflow with `mode: unattended` (or the Start dialog’s checkbox) runs every step as `claude -p …; exit`: Claude Code does the task, prints its answer and the process ends, which is a certain “done” signal (and a non-zero exit code fails the step’s gate). A step whose gate fails is started again in the same worktree with the findings added to its task. The price: no live terminal (only the final answer is printed), nobody can answer a question, file edits are accepted (`--permission-mode acceptEdits`) but shell commands only if the agent button already allows them (for example `--allowedTools "Bash(mvn test)"`). Agents that are not Claude Code run interactively as before.

**Merge when clean.** A workflow with `finish: merge` (or the Start dialog’s checkbox) merges every run of the workflow into your branch once all steps passed, but only while the merge guard has **no blockers and no warnings** (the two rules that need a person, “files reviewed” and “agent summary”, do not apply). Otherwise nothing is merged and the card says why; conflicts and a dirty working tree also stop it without changing anything.

**Jira.** *Pull in a work item…* now offers Azure Boards or Jira. *Set up Jira…* takes the base URL (Cloud: `https://yourorg.atlassian.net` with your email and an API token; Server / Data Center: a personal access token), optionally a project key, and checks the connection. The token is stored encrypted with the operating system’s key store (Electron `safeStorage`), never in a file in clear text, and saving is refused when the machine has no key store. Lists are “assigned to me” or “open sprint”; the summary and description (Jira’s document format is converted to text) become the task, the issue key links the pull request back. Read-only. Limits: acceptance criteria in custom fields are not read (put them in the description), and the Jira calls are only tested against a fake server.

**Workflow self-check** (Workflow dialog → *Self-check…*, or the palette): runs a throw-away two-step workflow with the agent you choose (step 1 writes a small file, step 2 reads it) and shows live whether Bazinga was told that step 1 finished (and whether that came from Claude Code’s hook or was guessed from a quiet terminal), whether the check ran, whether step 2 started by itself and whether the workflow completed, with advice for each failure. *Clean up* forgets it and discards its run. **Time limit per step**: `timeout: 30` in a step (minutes, 0 = none; also in the editor) stops a step that is still running after that and fails it, so a runaway agent does not work for an hour. **Resume**: a running step whose agent is gone (IDE restarted, terminal closed) shows *Resume*, which starts the agent again in the same worktree and tells it to look at what is already done and finish. **Post the result back**: when the input was pulled in from a Jira issue or Azure Boards item, the Start dialog offers *Post the result as a comment on …* (off by default). Only a comment is added (Jira REST, or `az boards work-item update --discussion`); nothing else on the item is changed.

**Debug log** (bug button in the Agents tab, or the palette: *Show the debug log*): a bottom tab that lists, with timestamps, what the workflow and the agents are doing: which agent a step picked and why, the command that was launched, when the idle detector fired (or that a terminal was quiet for 30 s without it), permission prompts, the gate result including the list of changed files, what the workflow decided next, buttons you pressed, terminal exits, and one line per model request from the tool-call helper. Filter by source, *Copy* what is shown, *Save…* the whole log, *Clear*. The log is also appended to `debug.log` in the IDE’s data folder (rotated at 1 MB). It holds commands and decisions, no environment values.

**Fleet** (top of the Agents tab, shown as soon as an agent terminal exists): all your agents at a glance, inspired by fleet dashboards. Per agent: a **context meter** (how much of the model's window the last request used; red from 90 % with a warning that the agent starts forgetting earlier instructions; a "prompt is too long" answer from the model server counts as a blowout too), a **state** (running, *needs approval*, *waiting for you* after a finished turn, **stale** when there has been no output and no model request for `fleet.staleMinutes`, default 5, or exited), tokens in/out, number of model requests, running time. The strip on top counts the states; click a count to filter, or type in the filter box, sort by what needs attention, context, tokens or time. Click an agent for its **timeline** (model requests, permission asks, finished turns, errors, exit). Local models report tokens through the tool-call helper (each agent gets its own address prefix `/t/<token>` so requests can be told apart); cloud Claude sessions have no helper, so their numbers come from the transcript file Claude Code names in the Stop hook (only files inside your `~/.claude` folder are read; the format is not a documented contract, so unknown lines are skipped). **Cost is an estimate** and only shown when you give prices: `.ide/config.json` → `"fleet": { "staleMinutes": 5, "prices": { "sonnet": [3, 15] } }` (dollars per million input / output tokens; the first key contained in the model name wins). Local models show no cost.

**Subagents** (Fleet): when Claude Code starts a helper agent (Task tool), the hooks `SubagentStart` / `SubagentStop` tell Bazinga. The agent's card shows `n/m subagents`, click it for each helper's type, duration and its last message, and a working helper stops the parent from being called *stale*. The exact fields of these hook events are not fully documented (`agent_id`, `agent_type`, `last_assistant_message` are used when present; anything missing is skipped). Not tested against a real Claude Code.

**Best of several agents** (*New agent run → Best of several agents…*): one task for up to six runs (any mix of agents, or one agent several times), each in its own worktree and branch. When all of them have stopped working you get a message, and the group card in the Agents tab offers *Rank results…*: it runs the gates on every result and ranks them (changed something → fewer gate errors → fewer warnings → smaller change; identical results are marked). It is a suggestion built from facts, you still read the diff. *Keep this one…* discards the other runs and opens the merge dialog for the winner. Local models share one GPU, so Bazinga asks before starting several. The group card is not kept when you close the IDE (the runs stay; use *Compare…*).

**Board** (*Board* button in the Agents tab): four columns. *Backlog* holds your open Azure Boards / Jira items that no run mentions yet (*Load backlog*; drag a card onto *Running*, or press *Start run…*, to open the new-run dialog filled from the item). *Running*, *Needs you* (asks for approval, finished its turn, or looks stuck) and *Ready to review* (the agent stopped) are your runs, with context meter and estimated cost; *Review*, *Merge…* and *Terminal* are on each card.

**Agents in a container** (Settings → Agent safety → *Run agent runs in a Docker container*): *New agent run* starts the agent with `docker run` instead of directly on your machine. The container sees the run’s worktree (`/work`), the repository’s git data (`/gitcommon`, so it can commit), a Docker volume with the agent’s own login, and only the environment variables you list (`ANTHROPIC_API_KEY` by default; passed by name, never on the command line). It runs with all capabilities dropped, `no-new-privileges`, and limits for memory, CPUs and processes; the network can be switched off. Your home folder, ssh keys, cloud credentials, other projects and Bazinga’s own data are not mounted. Settings → Agent safety has a **Check Docker / build the image…** button that finds Docker, builds the image from the files shipped with Bazinga and switches the option on; the *New agent run* dialog has a *Run in a Docker container* checkbox per run (by hand: `docker build -t bazinga-agent:latest docker/agent`) (Node, git, JDK 17, Maven, Claude Code; extend it for your stack) and log in to the agent inside it once. If Docker is missing, nothing starts. After a restart a containerised agent is *not* resumed on the host. Limits: it does not protect the repository itself (the agent can rewrite its own branch and, through the git data, other refs) or what the agent sends over the network, the toolbar agent buttons still run on your machine, and there is no network allowlist (that needs a proxy).

**Agent safety**: agent terminals start *without* variables that look like credentials (`*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `AWS_*`, `GITHUB_*` ...). Allow some with `"agentEnv": {"allow": ["GITHUB_TOKEN"]}`, or switch it off with `"agentEnv": {"scrub": false}`. Your own shells are untouched. This is a name-based filter, not a sandbox: the agent still runs as you. **Time budget**: `runBudgetMinutes` (Settings: *Time budget per run*) notifies you once when a run has used that much active agent time and stops the fix loop for it. **Run journal**: the journal button on a run shows a timeline (created, agent started, went quiet, asked for permission, fix rounds, guard result, merged or discarded). It lives in the repository's `.git` folder, so it survives merge and discard.

**Session replay** (the replay button next to the journal button on a run): scrub step by step through a run, oldest to newest, with the previous/next buttons or the slider. Each step is either a journal event (what it says above) or one of the commits the agent made along the way — click a commit's files to open the usual Monaco diff for it. Commits only show up here until the first time you open *Review* or the merge dialog for that run: `prepareReview()` folds them into staged changes at that point (so they show up in the Changes tab instead), which is also when they stop being separate steps here. Nothing new is recorded for this: it is built from the journal and the commits the run already has.

**Auto-merge** (Settings → *Auto-merge*, or `"autoMerge": { "enabled": true, "minWinRate": 0.8 }` in `.ide/config.json`; **off by default**): once the fix loop gets a run's gates fully clean (not just "no blockers" — `guard.clean`, the same bar as a run with nothing to say at all), Bazinga checks the scorecard for that exact agent and kind of task. With enough runs recorded (same 3-run floor as the scorecard) and a win rate at or above `minWinRate`, the run is merged there and then, without opening the merge dialog — squashed, with a notification saying why ("Claude wins 90% of bugfix tasks (10 runs)"). Anything else (not enough history, a weaker win rate, or a guard that still has something to say) leaves it in the run list as usual. An auto-merge is recorded in the scorecard and the merge log exactly like a manual one, so **Undo** (next to the run list) reverts it the same way. This skips the review queue entirely, which is why it defaults to off and needs a proven track record first — it is not meant to be the first thing you turn on.

**Adaptive guard rules**: the merge dialog remembers which blocking rule you ticked "merge anyway" past. After the third time you override the *same* rule, the guard box offers to relax it a notch (`block` → `warn`, or `warn` → `off`) right there, with a *Not now* to dismiss the suggestion without changing anything. Accepting writes the new level to your merge-guard settings immediately — equivalent to lowering it by hand in Settings, just offered at the point where the friction actually is. Counts are kept per user, across projects, alongside the scorecard.

**Local models and Claude Code extras**: before a local-model agent starts, Bazinga adds `--tools Read,Write,Edit,Bash,Glob,Grep --disable-slash-commands --strict-mcp-config` to its Claude Code command (unless it already has its own `--tools`), whatever an older saved button says. A small model that is offered skills and subagents uses them: one loaded a built-in skill for a refactor task, started four subagents of its own and ran for over an hour. Switch it off in Settings → Agents (*Local models get only file and shell tools*) or with `"ollama": {"restrictTools": false}`.

**Work items from Azure Boards**: *Pull in a work item…* in *New agent run* and in *Start a workflow* (or the palette entry *Azure Boards: start an agent run from a work item…*) lists your open stories, bugs and tasks (*Assigned to me* or *Current sprint*), and the one you pick fills the task or the workflow input with its title, description, acceptance criteria (or repro steps for a bug). It uses the Azure CLI, read-only: install `az`, run `az extension add --name azure-devops` and `az login` once. The organization and project come from the origin remote when it is on dev.azure.com, otherwise from `.ide/config.json`: `{ "workItems": { "orgUrl": "https://dev.azure.com/yourorg", "project": "YourProject" } }`. The text starts with `AB#1234`, so the run's pull request is linked back to the work item. Nothing is written to Azure Boards. Not tested against a real Azure DevOps organization. Jira is not built yet.

**Task templates**: *New agent run* has a template picker. Built-ins (bugfix test-first, feature, refactor, missing tests), your own in Settings, and per project in `.ide/tasks.md`: `## Name`, an optional `allow: src/**` line, then the text. The same name in a later layer replaces the earlier one (project over IDE over built-in). Text in `<angle brackets>` is selected for you to fill in, and *Start* refuses while one is still there. The scope line also knows `@tests` (test files only) and `@new-tests` (new test files only; the *Write missing tests* template uses it, so an agent that overwrites an existing test file is flagged out of scope).

**Weakened tests**: for every existing test file an agent changed, the review compares the file before and after: number of test cases, number of assertions, and always-true assertions (`assert True`, `assertTrue(true)`, `expect(1).toBe(1)` ...). Fewer cases, fewer assertions or new always-true ones mark the file as weakened, and the *tests* merge rule (block by default) applies, locally and in the CI guard. It counts lines by pattern, it does not parse the code; moving tests into another file shows up as weakened until you override it.

**Review rules**: `REVIEW.md` in the project root, and *Review rules* in Settings (all projects), are added to the AI-review prompt (IDE rules first, the project's file after them).

**Skills on two levels** (palette → *Agent skills…*, or the box button in the Agents tab): skills.sh-style folders with a `SKILL.md`. *Fetch* takes `owner/repo`, `owner/repo/path` or a https git URL (a shallow `git clone`; nothing is executed), previews each skill (and warns about non-text files), and installs to **this project** (`<project>/.claude/skills`, committed with it) or **all projects** (`~/.claude/skills`). A project skill wins over an IDE skill of the same name. Installed skills record their source and commit, so *Update* re-fetches and *Remove* deletes. Change the folder with `skillsDir` (for example `.agents/skills`).

**Find skills on the internet.** The *Agent skills* dialog starts with a search box for the [skills.sh](https://skills.sh) directory (the same public endpoint the official `skills` CLI uses: `GET /api/search?q=…`; the documented `/api/v1` API needs a Vercel token, which a desktop app cannot have). Results show the name, the GitHub repository and the install count. *Preview…* downloads that repository (a shallow `git clone`, nothing is executed), lists the files, pre-ticks the skill you picked and asks before installing, exactly like *Fetch*. Results that do not come from a GitHub repository cannot be installed here. Anybody can publish a skill, so the preview is the safety check: read the SKILL.md and look for scripts. Not verified here: the live endpoint (this sandbox cannot reach skills.sh; the search is tested against a fake server with the CLI’s request and response shape).

**Skills for every agent, not only Claude.** Claude Code reads `.claude/skills`; GitHub Copilot reads `.agents/skills` (project and home level) and `.github/skills`, but not `~/.claude/skills`. So every install, update and removal is applied to `skillsDir` *and* to each folder in `skillsMirrors` (default `[".agents/skills"]`), at both levels. *Sync to other agents* copies skills you installed earlier. For agents with no skill support at all (local models and simple CLIs) a managed block in the project's `AGENTS.md` lists the project skills and where their `SKILL.md` files are; only the text between the markers is ever changed. Turn that off with `"skillsIndex": false`.

## File change detection

Bazinga watches the project folder with the OS file watcher. If the watcher fails it restarts with backoff. It also polls (every 4 s while focused, every 12 s in the background) for changes (`git status` in a repo, a bounded file scan otherwise) as a safety net, and it refreshes when the window regains focus. The footer shows `● live` or `⚠ polling`; click it for diagnostics (watched folder, last event, last poll). Changes made inside an agent run's worktree are not shown while you view the main checkout; use Review on that run.

## Several projects

The project button (top left) lists your recent projects. Picking one replaces the project in this window and closes its terminals, so Bazinga asks first when something is running. `↗` or "Open folder in new window…" starts a second window with its own project, terminals and agent runs; nothing in the first window is touched. Settings are shared between windows.

## Settings

The settings dialog (gear) is grouped in tabs: *General* (theme, fonts, notifications, shell), *Agents* (agent buttons with a preset menu for Claude Code, Copilot, Codex, Gemini, Aider (cloud or a local Ollama model), or Claude Code on a local Ollama model/OpenAI-style server; task templates; checkpoints), *Review & checks*, *Oversight* (human-in-the-loop level, fix loop, merge guard), *Safety* (environment scrub, Docker, time budget) and *Editor* (language servers, code lenses). The last tab you used is remembered, and Save stores every tab at once.

## Local models (optional)

Nothing is bundled. Local models plug in through the same agent mechanism:

1. **macOS install helper** (optional): `npm run setup:local` (or `bash scripts/setup-local-models.sh qwen3:8b`) installs Ollama via Homebrew, starts it with a 32k context and downloads the model.
2. **Settings (the gear) → Agents → “Add from a preset…”** adds Claude Code on a local Ollama model. While Ollama runs, the menu also lists every model you have installed (“Claude Code on qwen3:14b (9.0 GB)”). The button is named after its model, and its terminal tab shows the context it runs with (`qwen3:8b · 32k`). The preset runs Claude Code against Ollama's Anthropic-compatible API (`ANTHROPIC_BASE_URL=http://localhost:11434`, `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=`), with only six built-in tools (`--tools Read,Write,Edit,Bash,Glob,Grep`: fewer tools means shorter prompts and fewer malformed calls, and the web tools it cannot use are gone), and with a standing hint (always pass the full absolute `file_path`, never call a tool without its required arguments) because small models drop arguments and call tools they cannot use. Those variables are also put in front of the command line (`env KEY=value claude …`), so an `export ANTHROPIC_API_KEY=…` in your `~/.zshrc` cannot send a "local" agent to the paid API. The model itself has to be served by something (Ollama, LM Studio, llama.cpp): Bazinga and Claude Code only talk to its endpoint.
   - **Ollama on another machine:** *Settings → Agents → Ollama server* takes `http://gpu-box:11434` (or just `gpu-box`, `192.168.1.20`; the port 11434 is added). The preset menu then lists the models installed *there*, new presets point at that server, and the pre-launch check, the load on click and the keep-loaded pings all go to it. On the server start Ollama with `OLLAMA_HOST=0.0.0.0` (and `OLLAMA_CONTEXT_LENGTH=32768`) and allow port 11434 in its firewall. The connection is plain http: your prompts and code are readable on the network. For anything but a trusted network, use an SSH tunnel (`ssh -L 11434:localhost:11434 gpu-box`, then keep the default `localhost` address) or an https reverse proxy. Bazinga treats an address as a model server when it is this machine, on a private network (10.x, 172.16-31.x, 192.168.x, `.local`/`.lan`/`.home`/`.internal` names, single-word names) or on port 11434, and never for `anthropic.com`. A model missing on a remote server is not downloaded for you: run `ollama pull` there.
   - **Claude Code quirks handled for you** (only for Claude Code agents whose address is a model server; your own `env` entries always win):
     - background calls (titles, summaries) and the `sonnet`/`opus` aliases all point at your model (`ANTHROPIC_DEFAULT_HAIKU/SONNET/OPUS_MODEL`), so Claude Code does not ask for models the server lacks or make Ollama swap models;
     - no calls to Anthropic (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, no surveys, no prompt suggestions, no terminal-title requests);
     - no beta headers and no thinking parameter (`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, `CLAUDE_CODE_DISABLE_THINKING`), which servers reject with “Extra inputs are not permitted”;
     - the real context window (`CLAUDE_CODE_MAX_CONTEXT_TOKENS`, 32768 or what Ollama reports), so Claude Code compacts the conversation instead of Ollama silently cutting the start off;
     - room in the window (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`): for a model name it does not know, Claude Code reserves 32000 tokens for the reply out of the context window (documented: a bigger value “reduces the effective context window available before auto-compaction”) and lets one file read fill 25000 tokens. On a 32k window that gave “Context limit reached” right after reading a 407-line file. Bazinga sets the reply reserve to 8192 (Settings → Agents → *Longest reply*, never more than a quarter of the window) and a file read to a quarter of the window; a bigger file is read in parts, as Claude Code tells the model to do. A reply longer than the limit is cut off, so raise it if a model has to write very large files in one go;
     - a stable start of the prompt (`CLAUDE_CODE_ATTRIBUTION_HEADER=0`), so Ollama can reuse its cached prompt instead of re-reading all of it every turn;
     - long timeouts (30 minutes, no idle cut-off), because loading a model and reading a long prompt take minutes on a laptop;
     - only one model in memory: other models loaded in the local Ollama are unloaded before yours is loaded (not those of terminals still open, never on a remote server; switch off under the agent list);
     - a note in the status bar when the model runs partly on the CPU (slow) or another model is still loaded.
   - **The tool-call helper (between Claude Code and the model):** Claude Code on a local model does not talk to Ollama directly. Bazinga starts a small helper on `127.0.0.1` (a random port, only this machine) and points Claude Code at it (`ANTHROPIC_BASE_URL`); the helper forwards to your Ollama, local or remote. It speaks the same Anthropic Messages API as Ollama's `/v1/messages`, streaming included. It does three things:
     - **It records what goes over the wire** (prompt size, what the model answered, how long it took), so a failure can be explained. The *Test* panel shows it under *Behind the scenes*.
     - **It repairs tool calls** (Settings → Agents → *Repair tool calls*, on by default): a call the model printed as text instead of making (`{"name": "Write", "arguments": {…}}`, in a code fence, in `<tool_call>` tags, OpenAI style, or Qwen's `<function=…>` XML) becomes a real tool call; wrong argument names (`path`→`file_path`, `text`→`content`, `cmd`→`command`, `filePath`…), wrong types, unknown arguments and null values are fixed; tool names like `write_file` become `Write`; relative file paths are made absolute from the working folder (Claude Code's file tools need absolute paths). Text that is not a tool call (answers, JSON data, names of tools that do not exist, calls cut off halfway) is passed on unchanged. Thinking and ordinary answers stream through live; only text that *starts* like a tool call is held back until it is complete. A call that still lacks a required argument after the repair is passed on, and Claude Code then tells the model so it can try again.
     - **It can slim the prompt** (*Send local models a slimmer prompt*, on by default): Claude Code sends tens of thousands of characters of instructions and tool descriptions with every request, which a local model has to read again each time. The helper replaces them with a short version: a few lines of instructions, the working folder, platform and date from the original, your standing instructions, and one-line descriptions of the six tools (the tool schemas themselves are untouched). Your messages and CLAUDE.md are not touched. Switch it off if a model seems to miss Claude Code's own rules.
     - When Claude Code is closed or cancelled, the helper hangs up on the model server too, so Ollama stops generating. Limits: only the Messages API of Claude Code is repaired (not Aider and others); a call that comes after other words in the same text block is not recognised; Ollama has no `count_tokens` endpoint (Claude Code estimates instead).
   - **Test a model:** every Claude Code agent on a model server has a *Test* button in Settings → Agents. It runs the agent's own command non-interactively (`claude -p …`) in a throw-away folder with a random secret word in `input.txt`, and checks three things: (1) the file is sent with `@input.txt` and the model answers with the word; (2) the model writes `output.txt` with its Write tool, checked on disk, so a model that only *describes* a write fails; (3) that file holds the secret word, which proves it read `input.txt` (the word cannot be guessed). The test reads Claude Code's `stream-json` output, so it shows what the model *did*, not only what it said: every tool call with its path and result (`Write(/x/output.txt) → FAILED: …`), and whether it claimed to have written a file without ever calling Write. A failure comes with the likely cause (a claimed write that never happened, a tool that failed, a path outside the folder, tool call printed as plain text, invalid parameters, server unreachable, wrong model name, context too small). With the helper on, the panel also lists what it had to repair ("the model wrote the Write call as text", "path → file_path"): a pass with repairs means the model works *with Bazinga*, not on its own. Each step waits up to 15 minutes (Settings → Agents → *Model test waits up to … minutes per step*). It can take minutes on a laptop; *Close* cancels it. Limits: the first check uses `@` in non-interactive mode, which may behave a little differently from the interactive prompt; and it uses the permission mode `acceptEdits` inside the throw-away folder only.
   - **qwen3 thinking:** qwen3 models “think” at length before every answer, which on a laptop can take minutes or never end (a test run got stuck for ten minutes right after reading a file). For qwen3 models Bazinga adds Qwen's own `/no_think` switch to the standing instructions (Settings → Agents → *Turn off qwen3 thinking*, on by default). Whether the model obeys is up to the model. If a test times out, the panel says whether the model was thinking, writing text or building a tool call, with its last words, and shows what it is doing while it runs.
   - **Missing model:** if the model is not installed you are offered the download: `ollama pull <model>` runs in a terminal and the agent starts when Ollama lists the model.
   - **Checked before it starts:** Ollama must answer, the model must be installed, and its context must be at least 32k. If not, you get the reason and the command that fixes it (`ollama pull …`, or the `ollama serve` line with `OLLAMA_CONTEXT_LENGTH=32768`), and can still start anyway. The context shown is what Ollama reports for the loaded model (`context_length`); servers that do not report it are not warned.
   - **Loaded on launch, kept loaded:** the model is loaded when you click the button (so the first request is not the slow one), and while its terminal is open it is pinged every 3 minutes so Ollama does not unload it after 5 idle minutes. Switch this off or change how long it is kept (`15m`) under the agent list.
   - **Standing instructions per agent:** each agent has a text box in Settings (Claude Code only). Add project rules in `.ide/agent-hint.md`. Both are written to a file in the app's data folder and passed with `--append-system-prompt-file`, so there is no shell quoting to get wrong. Not used in container runs (the file is on the host), or when the command already has its own `--append-system-prompt`.
   - **Dropping files:** a file dropped from the tree onto a Claude Code terminal is typed as `@path`, which puts its content straight into the prompt. A small model then does not need a working Read tool call (images and names with spaces stay plain paths).
   - **Local vs Claude:** *New agent run* has a button “Compare <local model> with <Claude>” that starts the same task for both in their own worktrees; then use *Compare…*.
3. **AI review with a local model**: the same dialog has *Use a local model (ollama run)* for the review command: free and private, but a small model reviews less well than Claude.
4. Other terminal agents built for local models (OpenCode, Aider, Goose...) are just more entries in the agent list.

Be realistic: Claude Code needs a model with tool calling and a 32k+ context, and small local models are clearly weaker than Claude at multi-step edits. Use them for small tasks and reviews, run them in an agent run (so a bad result is one click to discard), and keep Claude for the hard work.

## Keeping the agent in scope

At the top of the **Changes** tab:

| Feature | How |
|---|---|
| **Task + allowlist** | Type the paths the task may touch (`src/billing/**, docs/`), press **Start task**. That remembers what is already dirty (so it isn't blamed on the agent) and saves a checkpoint. Files changed outside the allowlist get a `scope` flag. **Clear** forgets the task. |
| **Edited tests** | Modified or deleted *existing* tests get a `test` flag, with the number of removed assertion-like lines. New tests are not flagged. This catches "made the test pass by weakening it". |
| **Agent summary cross-check** | **Copy summary prompt** gives you an instruction to paste into the agent ("end with a Files changed list"). Paste its answer into the box: files in the real diff that it never mentioned get an `unlisted` flag, and files it claims to have changed but didn't are shown in the summary line. |
| **Reviewed checkmarks** | Tick each file once you've looked at it (or **Mark reviewed** in the diff bar). Ticks reset when the file changes again. Flagged and unreviewed files sort first; committing with unreviewed files or warnings asks for confirmation. |

All of this is deterministic: no model call, no cost. The state is remembered per project.

## Duplicate code

Two gates, both reporting only on files and lines you changed, as **errors** by default so the agent has to fix them (the `ide-check` hook feeds them back to Claude Code):

- **Duplicate components** (built in, fast, no tool needed): finds React/Vue/Svelte components that duplicate or re-implement a shared one: the same component name defined twice, a new `SubmitButton`/`PrimaryButton`/`ModalBox` that doesn't use the shared `Button`/`Modal`, several variants and no shared base, and raw `<button>`/`<input>` where a shared component exists. Message example: *"SaveButton looks like another Button, but it does not use the shared Button (src/ui/Button.jsx:2). Reuse Button instead of building a new one."* Covers Button, Input, TextField, Select, Checkbox, Modal, Dialog, Card, Badge, Tooltip, Table and similar. It is a name-and-structure heuristic: it won't catch a duplicate with an unrelated name.
- **Duplicate code** (slow, needs `npm i -g jscpd`, version 5+): copy-paste detection across the whole project in 20+ languages, with literals ignored so a copy with different text or class names is still found. Needs 8+ lines / 70+ tokens. To tune or relax it, override the gate by name in `.ide/checks.yaml` (`severity: warning`, other `--min-lines`/`--min-tokens`, add `--similarity` for near-miss clones).

Set `severity: warning` on either gate if errors are too strict, and use `// jscpd:ignore-start` ... `// jscpd:ignore-end` around code that is meant to be repeated.

## Quality gates

Built in, each skipped automatically when its tool is not installed (you see *skipped: ruff is not installed* instead of an error):

| Gate | Tier | Needs |
|---|---|---|
| ESLint | fast | `eslint` in the project's `node_modules` |
| TypeScript (`tsc --noEmit`) | fast | `tsconfig.json` + `typescript` in `node_modules` |
| Ruff | fast | `ruff` on PATH |
| ShellCheck | fast | `shellcheck` on PATH |
| yamllint | fast | `yamllint` on PATH |
| Pyright | slow | `pyright` on PATH |
| Semgrep (`p/default`, metrics off) | slow | `semgrep` on PATH |
| Duplicate components | fast | nothing (built in) |
| Duplicate code | slow | `jscpd` 5+ on PATH |
| Maven compile / Maven test | slow | `pom.xml` + `mvn` on PATH |
| pytest | slow | `pytest` on PATH |
| Vitest | slow | `vitest` in `node_modules` |
| Go vet | fast | `go.mod` + `go` on PATH |
| Go build / Go test | slow | `go.mod` + `go` on PATH |
| Cargo check / Cargo clippy | fast | `Cargo.toml` + `cargo` / `cargo-clippy` on PATH |
| Cargo test | slow | `Cargo.toml` + `cargo` on PATH |
| .NET build / .NET test | slow | `dotnet` on PATH |

Gates run only on **changed files** (staged, unstaged and untracked), in chunks that stay under the Windows command-line limit, one after the other so a modest CPU is never saturated.

Java gates read real reports instead of scraping console output: Surefire/JUnit XML (failing tests with file and line), and Checkstyle, SpotBugs and PMD XML. In a multi-module repo `{modules}` expands to `-pl <changed modules> -am` (and builds everything when the root pom changed); `{modules-only}` omits `-am`. Gates can declare `reports:` globs and `reportFormat:` (`junit`, `spotbugs`, `pmd`, `checkstyle`, `sarif`); only reports written during the run are used.

Go and Rust compile/lint gates (`go vet`/`go build`, `cargo check`/`cargo clippy`) read file and line from the tool's own output (plain text for Go, `--message-format=json` for Cargo) the same way Maven does for `javac`. `Go test`, `Cargo test` and `.NET test` just report pass/fail with the output tail (`exitcode`), the same level of detail Vitest gets - none of the three has an always-installed structured test report the way Surefire/JUnit does.

Customise with `.ide/checks.yaml` (see `examples/.ide/checks.yaml`): add gates, override a built-in by name, disable some, or set `useDefaults: false`. Output parsers available: `eslint`, `ruff`, `pyright`, `shellcheck`, `yamllint`, `tsc`, `mypy`, `maven`, `cargo` (`cargo check`/`cargo clippy --message-format=json`), `sarif` (Semgrep, Trivy, Gitleaks, CodeQL...), `regex` (your own pattern with named groups `file line column severity message rule`) and `exitcode` (pass/fail, shows the output tail).

> YAML note: a command containing `: ` (colon + space) must be quoted, e.g. `run: "node -e \"...\""`. Invalid YAML is reported in the status bar.

### Let Claude Code run the gates on its own edits

This is the highest-value part: the agent sees the errors immediately and fixes them before you review anything.

```powershell
node C:\tools\bazinga\bin\ide-check.js            # manual run, all tiers, changed files
node C:\tools\bazinga\bin\ide-check.js --tier fast --json
```

For a PostToolUse hook, copy `examples/claude-code-hook.settings.json` into your project's `.claude/settings.json` (adjust the path). In `--hook` mode the command prints nothing when clean and exits 2 with the errors on stderr otherwise, which Claude Code feeds back to the model. Check the current Claude Code hooks documentation if the settings format has changed.

## Project files (`.ide/`, all optional)

- `config.json`: `shell` (e.g. `"cmd.exe"` or `"C:\\Program Files\\Git\\bin\\bash.exe"`), `shellArgs`, `autoCheck`, `autoCheckpoint`, `agents`, `reviewCommand`
- `policy.json`: the shared merge-guard floor (see *Oversight levels, guards and skills*)
- `tasks.md`: project task templates
- `scripts.yaml`: the Scripts tab
- `checks.yaml`: the quality gates

Default shell is PowerShell on Windows. If a CLI installed via npm is blocked by PowerShell's execution policy, set `"shell": "cmd.exe"`.

**Trust:** `scripts.yaml` and custom `checks.yaml` run shell commands, so the app asks once per project before running them (like VS Code workspace trust). The built-in gates need no prompt. The ide-check CLI does not prompt: you are running it yourself.

## Integrations

All of these are optional and off or harmless by default. What has been run against the real thing is stated per item; "unit tested" means the logic is covered by tests but has not met the real external program yet.

**Config check (ajv).** `.ide/config.json` and the settings are validated against a schema when a project opens. A typo such as `fleet.staleMinuts` shows a status message with a suggestion; it never stops the project from loading.

**Search (ripgrep).** `@vscode/ripgrep` is bundled, so search is fast without installing `rg`. If the binary is missing it falls back to `rg` on PATH, then to the built-in JavaScript search.

**Diagrams (mermaid).** ` ```mermaid ` blocks in the Markdown preview are drawn as diagrams. The library (about 5 MB) loads only when a preview contains one, runs in strict mode and the SVG is sanitised again. A broken diagram shows an error box instead of breaking the preview. Checked in the real app.

**Updates (electron-updater).** Checks for a new release at every start by default (`updates.check`, on unless you turn it off); nothing ever downloads or installs without a click either way, and *Check for updates…* in the command palette works regardless. No feed is hardcoded: a packaged build released through `.github/workflows/build.yml` already carries its own feed (electron-builder writes `app-update.yml` from the repository it was built in), or set `updates: { "github": "owner/repo" }` (or `"url"` for your own server) to point it somewhere else. Limits: macOS only auto-installs a signed app (ad-hoc-signed builds point you at the releases page instead - see *Unsigned apps* above for turning on real signing and notarization), portable Windows builds cannot update themselves, Linux has no auto-update path at all, and it has not been run against a real release feed yet.

**Symbols (tree-sitter).** Java, Kotlin, JS/TS, Python, Go, Rust and C# use real parsers for the symbol lens and outline; other languages and any failure fall back to the regex scanner. `symbolParser: "regex"` forces the old behaviour.

**Jev (TypeSafe AI), optional.** [Jev](https://innfactory.ai/en/ai-models/typesafe-jev/) is a decision model: it does not write text, it answers typed questions (pick an option, a score, a yes/no probability) with probabilities in 70–500 ms. Bazinga uses it for one thing for now: recognising the **kind of a task** (tests, bug fix, refactor, …) for the scorecard and the advice in *New agent run*, instead of keyword rules. It is off by default. Paste your key in *Setup & health → Smarter task recognition → Set up…* (it is stored encrypted by your operating system, never in a settings file); the environment variable `TYPESAFE_API_KEY` still works as an alternative. **What leaves your machine: the task text, cut at 2000 characters, and nothing else** (no code, diffs or paths), to TypeSafe’s API, which is documented as US-hosted with no EU region: check this with your employer before using it for work tasks. Whenever Jev is off, unreachable, slower than 4 s, unsure (below `jev.minConfidence`, default 0.6) or answers in a layout Bazinga does not know, the keyword rules decide, so it can only improve the result. Settings in `.ide/config.json` or the settings: `jev: { enabled, model, endpoint, keyEnv, minConfidence, timeoutMs }`. Written from TypeSafe’s public documentation, early access since 15 September 2026; **never run against the real API** (the request shape is documented, the exact answer layout is only partly, so it is read defensively). Other places that could use it, not done: bug fix detection in the merge guard, deciding when to hand over to a stronger agent, a risk score for a diff.

**Claude Code version watch.** Bazinga records the Claude Code version at startup (`claude --version`) and from its telemetry (`service.version`, so also the one inside a container). Command palette → *Claude Code compatibility* shows it and lets you **confirm** the current version once you have seen it work. From then on a status notice appears when Claude Code is newer than the confirmed version, or when a hook report carries top-level fields Bazinga does not know (names are kept, never values). A notice means “look again”, not “broken”. The list of known fields comes from Claude Code’s documentation, not from a real capture yet, so expect some harmless notices at first. Unit tested only.

**Capture of real traffic.** For checking the integrations against the real programs. Command palette → *Capture real traffic: turn on or off*. While it is on, Bazinga writes what Claude Code, your model server and ACP agents really send it into a folder: hook reports, telemetry (including the content type of anything it had to refuse, such as protobuf), the model requests and the server's raw replies (as separate frames, so the chunking shows), ACP messages in both directions, and a few transcript lines with token usage. **Nothing readable is kept**: every text (prompts, code, answers, file contents, paths, ids, tool arguments) is replaced by its length (`<str:132>`); only the shapes stay: field names, types, event, tool and model names, finish reasons, numbers. Authorization headers are never recorded. At most 120 records per kind. *Capture: show the files* writes everything into one `bazinga-capture.json` and opens its folder; send me that file and the shapes become test fixtures. *Capture: delete the captured files* removes it all. It is off by default and stays on until you turn it off again (it is the `capture` setting), so turn it off when you are done.

**OpenAI-style model servers.** Claude Code only speaks Anthropic's API, but LM Studio, llama.cpp, vLLM and many gateways speak OpenAI's. Add the preset *Claude Code on an OpenAI-style server* (or set `"api": "openai"` on an agent) and the tool-call helper translates in both directions: messages, tools, images, streaming and tool results. The repairs for small models still apply on top. Set the server address in the agent's `ANTHROPIC_BASE_URL` (with or without `/v1`), the model in `--model`, and optionally `"context": 65536` (the server's real context window, which Claude Code needs to know to compact in time). An API key goes in `ANTHROPIC_AUTH_TOKEN` and is sent as a bearer token. Nothing is loaded or unloaded on such a server. `count_tokens` is answered with an estimate. Tested against a fake server, including streaming split into odd pieces; not yet against LM Studio itself, so thinking models and servers with unusual tool-call chunking are the likeliest rough spots.

**Cost and activity (OpenTelemetry).** Cloud Claude runs get OTLP settings pointing at a local receiver (JSON only, per-run token in the URL); real token and cost numbers then replace the estimate in the Fleet panel. Prompt text is never kept. Switch off with `telemetry: { "otel": false }`. Unit tested; not yet verified against a real Claude Code that it sends http/json.

**MCP server.** With `mcp: { "server": true }` agents started by Bazinga can call `list_runs`, `run_status` and `start_run` (starting a run asks you to confirm, at most 5 per session). Local only, Host/Origin checked, token per run. Unit tested; not verified against a real Claude Code.

**ACP agents.** Agents that speak the Agent Client Protocol (over stdio) get a chat-style transcript instead of a terminal: streamed text, tool cards, plans, and permission cards with the agent's own options. Add one in the settings:

```json
{ "name": "My ACP agent", "command": "my-agent --acp", "protocol": "acp", "policy": "ask" }
```

`policy` is `ask` (default), `allow` or `reject`. Runs started without you watching (workflows, best-of) refuse permission requests unless the agent says `"policy": "allow"`. File access by the agent is limited to its run folder, and ACP agents do not run in containers yet. Verified in the real app against the protocol SDK's example agent and a raw JSON-RPC agent; not yet tried against a real product's adapter.

## Command line (without the window)

`bin/bazinga.js` (installed as `bazinga` with `npm link`, or run `node bin/bazinga.js`) is the part of Bazinga that needs no window:

- `bazinga check` runs the quality gates on the changed files (same as `ide-check`; `--hook` for Claude Code).
- `bazinga guard --base origin/main` runs the merge guard (same as `ide-guard`). `--format azure|github` writes pipeline annotations, `--strict` fails on warnings, **`--comment`** also puts the result on the pull request as one comment that is updated on every run (Azure DevOps: map `SYSTEM_ACCESSTOKEN` and give the build service *Contribute to pull requests*; GitHub: `GITHUB_TOKEN` with `pull-requests: write`). Without a token nothing is posted and the build is not failed for it. See `examples/` for ready pipelines; `node scripts/export-guard.js <repo>/tools/bazinga` copies the guard (no `npm install`) into a repository.
- `bazinga hook install [--base origin/main] [--merge]` adds a git `pre-push` hook (and with `--merge` a `pre-merge-commit` hook) that runs the guard locally. A hook you already have is never overwritten; `BAZINGA_SKIP=1` skips it once; `bazinga hook uninstall` removes only Bazinga's.
- `bazinga proxy --upstream http://localhost:11434 [--format openai] [--port 8787]` is the local-model helper on its own: it repairs the tool calls of small models and shortens Claude Code's tool descriptions, and translates OpenAI-style servers (LM Studio, llama.cpp, vLLM). Then start Claude Code with `ANTHROPIC_BASE_URL=http://127.0.0.1:8787 ANTHROPIC_AUTH_TOKEN=local claude --model <model>`.

Tested with fake servers, fake pipeline APIs and real git repositories; **not** yet run in a real Azure DevOps or GitHub pipeline.

## Packaging

```powershell
npm run dist      # Windows installer + portable .exe in dist\
npm run pack      # unpacked app only
```
`asar` is off on purpose (node-pty and Monaco workers). A packaged app takes the project path as its first argument. Builds were verified on Linux (`--dir`, smoke test passes); the Windows build is untested. Unsigned executables may trigger SmartScreen.

## Tests

```
npm test          # unit tests for every core module (parsers, git, runner, CLI hook, fix loop, local history, Spring map, LSP client, the `bazinga` CLI, PR comments, git hook, standalone proxy, cost, version watch, ...)
npm run smoke     # (BAZINGA_BIN=path/to/packaged-exe to test a build)
                  # launches the real app against a throw-away repo and checks Monaco, xterm, pty and the gates end to end
```

The smoke test is a real Electron run and was occasionally red for no visible reason. Cause found by running it 14 times, half of them with the CPU saturated: when the machine is busy, Monaco's editor web worker script sometimes fails to load (`importScripts … editor.worker-….js failed to load`). Every step still passes (the editor does that work on the main thread). `core/smokeerrors.js` lists exactly that error under `warnings` instead of failing the run; every other page error still fails it.

## More features

- **Fix loop**: when an agent goes idle, the gates run and the findings are pasted back into the agent terminal. It stops when clean, after the round limit, or when two rounds give identical findings. **Related tests (opt-in, Settings → Fix loop)**: once the static gates are clean, the tests that belong to the changed files (changed test files, tests named after the changed class, tests that mention it; at most 5 files) are run and failures go back to the agent with the output tail. "Identical" then also means the same test output (digits ignored), so an agent that gets a different assertion failure is still making progress. A timeout or a missing test runner is skipped, never reported as a failure; `fixLoop.testTimeoutSec` (default 120) limits each file.
- **Merge guard**: merging a run is checked per rule (errors and weakened tests block; scope, unreviewed changes, missing summary and gates-not-run warn). Blockers can be overridden with "merge anyway". Policy is configurable in `.ide/config.json`.
- **Pull requests**: the merge dialog can open a PR instead, via `gh` (GitHub) or `az repos` (Azure DevOps). Needs the CLI installed and logged in. The PR button on a run card (and the linked work items) asks `gh pr view` / `az repos pr list` for the **status**: open/draft/merged/closed, review decision, merge conflicts and, on GitHub, how many checks passed or failed (Azure DevOps policy evaluations are not shown). Work items are taken from the branch, run name, task and commit messages: `#123` links to the GitHub issue (GitHub repos) or the Azure Boards item (Azure repos), `AB#123` too; ticket keys like `PROJ-12` only link when `workItems.jiraBaseUrl` is set in the config. Network calls happen only when you click.
- **Notifications**: a desktop notification when an agent finishes, a fix loop ends or gates fail, only while the window is unfocused.
- **History tab**: commit graph with branches and tags, commit diffs, stash (save, apply, pop, drop) and blame in the editor. Per-hunk staging from the editor.
- **Start-up and errors.** If the window cannot start, a dialog says so (reload / copy details / open log folder). Errors from actions are written in plain words with the technical text in brackets.
- **Other editors.** *Open this file in VS Code / IntelliJ* (editor right-click menu and command palette; needs the `code` / `idea` command line launchers; `externalEditor` in the settings chooses, default `auto`). *Debug* lens above tests: pytest opens pdb in the terminal; JUnit waits on port 5005 for IntelliJ (Run → Edit Configurations → Remote JVM Debug); node:test waits on port 9229.
- **While you were away / Undo.** After 15 minutes away from the window, and at start-up, a summary of agent runs (need you, ready to review, merged, thrown away); also *While you were away* in the command palette. *Undo a merged run* adds a revert commit for a merge Bazinga made (nothing is deleted; it refuses with uncommitted changes, and leaves the branch untouched when later changes clash).
- **Unattended steps in the container.** Workflow steps in unattended mode run in the Docker container when the image is built, even when containers are not switched on for everything (`containerWhenUnattended: "off"` to disable). Without Docker they run as before and you get a one-time tip.
- **What's new.** The changelog opens once after an update; command palette → *What’s new in Bazinga*.
- **Usage & insights** (command palette → *Usage & insights*). Sections appear only when there is something to show:
  - *Claude plan limits*: off by default. Switching it on adds a small status-line command (`bin/statusline.js`, needs `node` on the PATH) to the Claude Code sessions Bazinga starts; Claude Code hands it the 5-hour and 7-day percentages, Bazinga keeps them and shows them with the reset time. **It replaces your own Claude Code status line in those sessions.** The fields are not documented by Anthropic as far as I could find, so if your plan or version does not send them, the section keeps saying it is waiting (API-key use never has plan limits). Numbers older than 6 hours are labelled old.
  - *Tokens and cost*: today, 7 and 30 days from finished runs (same data as the scorecard); local runs count as free, unknown cloud cost is counted separately instead of as zero.
  - *Working time by kind of task* and *Local models in memory* (from Ollama: size, context, and how much of it fits on the GPU).
  - On request: *Dependency problems* (`npm audit`, Dependabot alerts through `gh`; Maven/Gradle projects need the OWASP dependency-check plugin, which Bazinga does not run), *Code quality* (SonarCloud quality gate of the current branch; project key in the window or `insights.sonarProject`; private projects need `SONAR_TOKEN` in the environment), *Running Spring app* (Actuator health and a few metrics from `insights.actuatorUrl`, default `http://localhost:8080/actuator`).
  - *Coverage marks*: palette → *Coverage: show marks*. Reads `coverage/lcov.info`, `target/site/jacoco/jacoco.xml`, `build/reports/jacoco/test/jacocoTestReport.xml` or `coverage.xml` (whichever exists) and marks covered (green) and missed (red) lines in the gutter; run your tests with coverage on first, the marks follow the file's age shown in the status bar.
  - Tested with unit tests on sample output and in the real app window; not yet against a real Claude Code status line, SonarCloud, Dependabot or a live Actuator.
- **GitHub Copilot usage (optional).** Off by default. If you have a Copilot licence: Setup & health → *GitHub Copilot usage* → *I use Copilot* (or `"copilot": { "enabled": true }`). The row then has an *Open my usage* button, and the command palette gets *GitHub Copilot: open my usage*; both open github.com/settings/billing, where the premium requests used and the reset date are. Bazinga does not fetch the numbers itself and needs no token.
- **Run tests and see if they pass** (Java/Kotlin with Maven or Gradle, node:test, Vitest, Jest, pytest): a `Run all tests in this file` lens on line 1 of a test file and a `Run test` lens above each test (`Run all in this group` above a `describe`/class). The test runs inside the app; the lens then shows `✓ Passed`, `✗ Failed`, `⚠ No test ran` or `⚠ Runner missing`, and clicking it shows the output. A pass is only reported when tests actually ran: a name filter that matches nothing (exit code 0, zero tests) is shown as *No test ran*. Failures open the output with *Open in terminal* and *Run again*. The command palette has *Run test at cursor* and *Run all tests in this file*. Tests are found by line patterns, so unusual formatting gets no lens. Unsaved files are saved before the run.
- **Lenses above classes and methods** (Java, Kotlin, TS/JS, Python): `N usages` (click searches for the name; **exact** and clickable to a list of locations when a language server is enabled for that file, see below) and `author, 3 w ago` (git blame of that method's lines; the commit message is in the hover popup, click opens the commit; unsaved buffers show usages only). Usages are counted by name over the whole project with a small index that re-reads only changed files, so same-named methods in other classes are included: it is an approximation, not a language server's exact answer. Methods are recognised by line patterns, so unusual formatting simply gets no lens. Both can be switched off in Settings or with `symbolLenses` in `.ide/config.json`.
- **Spring awareness** (Java and Kotlin, found by annotation patterns, not from a running app): a lens with the HTTP route above each handler (`GET /api/users/{id}`, class-level `@RequestMapping` included; click copies the path), `N implementations` / `N subclasses` above interfaces and base classes (click lists or opens them; matched by simple name), and **Spring: endpoints and beans…** (command palette, or the Scripts tab of a Spring module) with a filterable list of endpoints, `@Bean` methods and stereotype classes. Switch off with `symbolLenses.spring`.
- **Memory**: closing a tab disposes its editor models (checked by the smoke test), and terminals keep `terminalScrollback` lines (default 2000, Settings or `.ide/config.json`, 200 to 50000) instead of a fixed 5000.
- **Diff review comments**: click the glyph margin of a diff (or Ctrl/Cmd+Alt+M) to attach a comment to a line; *Send comments* pastes them, with file and line, into the agent terminal. Unsent comments are kept per project and re-attached after a restart (to the nearest line with the same text; a comment whose line is gone is dropped).
- **Permission prompts**: when an agent stops at an approval question ("Allow this command? (y/n)") the terminal tab gets an *approve?* badge, the run shows *needs approval*, you get a notification, and the fix loop does not paste into the question.
- **Terminal search** (Ctrl/Cmd+F in a terminal), **Markdown preview** (Ctrl/Cmd+Shift+V; sanitized, images only as data URIs), and **file and image drop**: drag a file from the tree or the OS into a terminal to type its path; paste an image to save it and type its path.
- **Command palette** (Ctrl/Cmd+Shift+P), **run-test** code lenses above tests, **font size** shortcuts, memory use in the status bar.
- **Secrets gate**: built-in detection of common credentials (messages are redacted); gitleaks is used too when installed.
- **Build and run (Scripts tab)**: finds Maven and Gradle modules (also in subfolders), uses `mvnw`/`gradlew` when present, and for Spring Boot apps (`@SpringBootApplication`) shows a **Run** button with a profile picker (profiles come from `application-<profile>.yml/.properties`) and an environment box (`NAME=value` per line, remembered per project). Task chips run clean, compile, test, verify, package without tests, and the dependency tree. A **JVM args** box and a **debug port** start the app with a JDWP agent (Maven; the app does not wait for the debugger; Gradle only supports port 5005 with `--debug-jvm`, which waits), and **Save** stores the combination as a named run configuration in `.ide/run.json` (shared through git, validated like the other fields, listed under the module). Profile names and variable names are validated, the profile is quoted for your shell, and the first run asks for project trust like scripts do.
- **Compare agent runs**: in *New agent run* pick a **second agent** to give the same task to (a second worktree, started without switching away), then **Compare…** in the Agents tab shows both side by side: files and lines changed, files only one changed, files both changed with or without the same result, and (optional) the gate result of each. It does not judge which is better.
- **Local history**: every save and every change on disk is kept outside the project (in the IDE's data folder), with automatic pruning by age, count and total size. Command palette → *Local history of this file…* lists the versions of the open file, shows a diff and restores one (the current content is kept first). It also catches what an agent overwrote before you committed anything.
- **Environment check**: `npm run doctor`, or *Check environment…* in the palette, shows which tools are present and which are too old (node, git, the agents, Java/Maven/Gradle, `gh`/`az`, ripgrep, language servers) with a hint for each missing one.
- **Run statistics**: each agent run card shows how long the agent actually worked (time its terminal was producing output, not your reading time) and how many fix-loop rounds it needed, e.g. `worked 12m · 2 fix rounds`. Only runs whose terminal the IDE started are measured, and idle detection is a heuristic.
- **Terminal restore**: after a restart the plain terminals and agent terminals reopen in the same folders. Claude Code and Copilot CLI are resumed with `--continue`, Codex with `codex resume --last`, Gemini with `gemini --resume latest`; for any other agent (Aider included - it has no resume command) add `"resumeCommand"` to its entry in the settings or `.ide/config.json` (otherwise it only reopens the folder and says so). The IDE stores titles and folders only, never terminal content, and ignores folders outside the project.
- **Language servers (opt-in)**: hover, go to definition, references, completion and diagnostics. Off by default; enable in Settings → Editor or `.ide/config.json`. Built-in default commands exist for Java (`jdtls`), Python (`pyright-langserver`), TypeScript/JS (`typescript-language-server`), Go (`gopls`), Rust (`rust-analyzer`) and C# (`csharp-ls`) - nothing is bundled, so each is only used once installed and found on your PATH:

```json
{ "lsp": { "enabled": true, "servers": {
  "python": { "command": "pyright-langserver", "args": ["--stdio"], "extensions": ["py"] },
  "java": { "command": "jdtls", "extensions": ["java"] },
  "typescript": { "command": "typescript-language-server", "args": ["--stdio"], "extensions": ["ts","tsx","js"] },
  "go": { "command": "gopls", "extensions": ["go"] }
} } }
```

A server command defined by a project asks for your approval before it runs. Results outside the project root are ignored. With a server enabled for a file, the usages lens asks it for **exact references** (declaration excluded, answers cached per file content, 4 s budget per refresh). If the server is still starting or indexing, the lens falls back to the count by name and the exact number appears on a later refresh.

## Known limits

- Items from the command-line work are tested with fake servers, fake pipeline APIs and real git repositories only: `bazinga guard --comment` has not run in a real Azure DevOps or GitHub pipeline, the git hook has not run on Windows, `bazinga proxy` has not been put in front of a real LM Studio / llama.cpp / vLLM, and the container image build has never run (no Docker where this was built).
- Cost per merged run depends on the agent's own telemetry (or your `fleet.prices`); it is not a bill. Runs started before this existed have no cost.
- The Claude Code version watch compares against a field list taken from the documentation, not from a real capture.
- Tested only with fakes or simulation: real OS file drags and clipboard screenshots (events are simulated), skills fetched from real GitHub URLs (unit-tested against local git repositories), the permission-prompt patterns (matched on sample output of Claude Code style prompts, other agents may word them differently), and the environment scrub (checked on the variables passed to the pty, not against a real agent).
- Built and tested on Linux (unit tests plus a headless Electron smoke run, including a real pty). It has **not** been run on Windows yet, so expect to fix small things there: ConPTY behaviour, path edge cases, antivirus slowness.
- No debugger, no extension marketplace, no rename/refactoring (the language-server client deliberately does not implement rename).
- Spring/Maven/Gradle commands are built and unit-tested, and the UI is smoke-tested, but no real Maven/Gradle build was run here; `copilot --continue` comes from GitHub's CLI reference, `codex resume --last` from OpenAI's and `gemini -i {task}` / `gemini --resume latest` from Google's, and none of the three was run against the real CLI here.
- Language servers (including exact usages), `gh`/`az` pull requests and their status, and OS notifications are tested with fakes and unit tests only (sample JSON for `gh`/`az`), not against jdtls, pyright, typescript-language-server, real GitHub/Azure DevOps or real OS notification centres. Spring endpoints, beans and implementations are text patterns: meta-annotations, constants in mapping paths and Kotlin DSL routes are missed.
- The related-tests step of the fix loop is tested with real `node --test` files; Maven, Gradle, pytest and vitest commands are built and unit-tested but were not run here.
- Copilot, Codex, Gemini and Aider run as CLIs in a terminal; there is no inline completion.
- If the antivirus scans `node_modules` and `.m2`, Maven and npm gates will be slow whatever the IDE does. Ask IT for exclusions.
- Hunk revert and hunk staging work on the change under the cursor, using git's own hunks.

## Layout

```
src/core/      git, config, checks runner, parsers (no Electron dependency; shared with the CLI)
src/main/      Electron main process, pty, IPC, workspace trust
src/renderer/  UI: Monaco, xterm, panels (no bundler; assets load straight from node_modules)
bin/ide-check.js
```


## Theme and fonts

- **Nine themes**: System, Light, Dark, **High contrast** dark and **High contrast, light** (low vision — pure black/white either way, thicker borders, the whole UI scaled up 20%), **Night** (late work — warm, dim, no blue in the palette), **Nerd** (green phosphor terminal, monospace UI, a faint CRT scanline texture), **Tron** (black with electric cyan on the Grid, amber for anything that needs to stand out, a faint grid-line texture) and **WarGames** (amber CRT phosphor, the WOPR terminal, same scanline texture as Nerd in amber). The theme button in the toolbar is a quick light/dark toggle, not a picker: it flips a theme to its light/dark twin where one exists (Light ↔ Dark, High contrast ↔ High contrast light); Night, Nerd, Tron and WarGames are deliberately dark-only (that's the point of all four), so toggling away from any of them lands on plain Light instead. The full list of all nine is in Settings → General → Theme. Monaco, the diff editor and the terminals switch with it.
- **Roboto** is the UI font. The monospace font (editor, terminals, and every other `--font-mono` spot: review output, journal, code in markdown) is picked in Settings → General → Font: **Roboto Mono** (default), **JetBrains Mono**, **Fira Code**, **Cascadia Code**, **Source Code Pro** or **IBM Plex Mono** — all OFL-1.1 and bundled (`@fontsource`), so nothing is fetched at runtime and every choice works offline and in the packaged app. The Nerd theme uses whichever one is picked for the whole UI, not just code (`--font-ui: var(--font-mono)`).
- Colours live in one palette per theme (`:root` plus one `:root[data-theme="..."]` block per extra theme in `styles.css`). `test/theme.test.js` discovers every theme block automatically and checks that each defines the same variables as the base palette, that no colour is hard-coded elsewhere, and that text keeps at least 4.5:1 contrast.
- Screenshots in another theme: `BAZINGA_THEME=<light|high-contrast|high-contrast-light|night|nerd|tron|wargames> npm run screenshots -- docs/screenshots/<name>`.
- **Custom themes** (Settings → General → “Create custom theme…”): pick three colours — background, text, accent — and the rest of the palette (surfaces, muted text, errors/warnings/success, the commit graph lanes) is generated from them, with every text colour nudged in lightness until it clears the same 4.5:1 contrast bar the nine built-in themes are held to (or as close as that hue can reach, shown in a summary). An expandable section lets you override any individual generated colour by hand afterwards. Unlike the built-in themes, a custom one has no `:root[data-theme="..."]` block in `styles.css` — its colours are stored in Settings (`customThemes`, IDE-wide, not shared via a project's `.ide/config.json`) and applied as inline CSS variables at runtime. The derivation itself (`src/core/custompalette.js`, exposed over IPC as `api.theme.derive`/`api.theme.contrast` since the renderer is sandboxed and can't load it directly) is unit-tested the same way `test/theme.test.js` tests the built-ins; see `test/custompalette.test.js`.

## Icons

Toolbar, sidebar rail, bottom tabs, file tree (folder and per-language file icons), agent runs, diff bar and problem severities all carry an icon. They are inline SVG (the [Lucide](https://lucide.dev) set, ISC license) in `src/renderer/icons.js`, so they use the text colour and follow every theme, and nothing is fetched at runtime. The sidebar rail (Files/Search/Agents/Changes/History/Scripts) always shows icon and label, stacked.

To add an icon: put its Lucide name in `scripts/build-icons.js`, run `npm i --no-save lucide-static && node scripts/build-icons.js`, and use `ic('name')` in `app.js` (or `data-icon="name"` in `index.html`). `test/icons.test.js` and the smoke step "icons resolve" fail on unknown names.
