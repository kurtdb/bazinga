# Notice

This skill is a modified, standalone copy of a skill from Google's
Elephant-Goldfish Model (EGM), https://github.com/google/elephant-goldfish-model,
licensed under the Apache License, Version 2.0 (see LICENSE in this folder).

Copyright Google LLC.

Changes made for this standalone copy (bundled with Bazinga, installed as a plain
skill folder rather than through Claude Code's/Codex's plugin system):
- Replaced the `${CLAUDE_PLUGIN_ROOT}`-relative and `../../docs/`-relative references
  in SKILL.md with a short note pointing at this folder's own `agents/`/`resources/`
  content instead.
- Where this skill spawns reviewer/worker personas, merged each Claude Code
  `.claude-plugin/agents/<name>.md` adapter (tool/context restrictions) with its
  canonical `agents/<name>.md` persona body from the upstream repository, so the
  persona is self-contained in this skill's own `agents/` folder.
- Dropped `TEST.md`/`test_scenarios.yaml` (upstream's own repository test harness
  scaffolding - meaningless once this skill is copied out on its own).

This is not an officially supported Google product. For the full plugin (native
subagent registration across harnesses, auto-updates, every skill), install it the
way upstream intends: https://github.com/google/elephant-goldfish-model#install
