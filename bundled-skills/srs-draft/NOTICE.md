# Notice

This skill is a derivative, standalone port of rule/template content from Testany's SRS Writer,
https://github.com/Testany-io/srs-writer-plugin, licensed under the Apache License, Version 2.0 (see
LICENSE in this folder). That repository is archived/read-only; the port is based on its `main` branch
as of 2026-11-07.

This is not an officially supported Testany product. For the full extension (native VS Code chat
integration via GitHub Copilot, the full 12-specialist engine, project/session management, git
automation, HTML/CSS/JS prototype generation), install it the way upstream intends:
https://marketplace.visualstudio.com/items?itemName=Testany.srs-writer-plugin

## What this port keeps

- The entity schema and ID conventions from `.templates/schemas/requirement-entity-schemas.yaml`
  (`reference/requirements-schema.md`), including its dictionary-not-array rationale.
- The section structure and field skeletons from `.templates/*/*_template.md`
  (`reference/section-templates.md`), condensed.
- The "explore and read before you write, never assume document content" discipline and the
  Plan -> Draft -> Self-Review loop (including its self-check table) from
  `rules/base/content-specialist-workflow.md`.
- The scoring bands and common-pitfalls list from `rules/base/quality-guidelines.md`
  (`reference/quality-bar.md`) - **translated from the original Chinese**, which is the language the
  upstream base rules are written in.
- The never-fabricate-a-detail principle from the content specialists' own "Plan" step, which bans
  inventing content to fill a gap.

## What this port drops, and why

- **The 12-specialist fan-out** (`rules/specialists/content/*.md`: separate agents per section type)
  and its custom tool-calling protocol (`edit_instructions`, `requires_file_editing`,
  `structuredData`, `{{baseDir}}` path templating) - this is bespoke to upstream's own orchestration
  engine (`src/core/orchestrator.ts`, `src/core/specialistExecutor.ts`, etc.), which Bazinga doesn't
  have and has no reason to rebuild for a single-document drafting task. One skill drafting all
  sections in a fixed order covers the same ground without it.
- **VS Code chat integration** (`src/chat/srs-chat-participant.ts`, the `@srs-writer` chat participant)
  and its GitHub-Copilot-specific chat provider dependency.
- **Project/session management, git branch automation, workspace initialization**
  (`src/core/session-manager.ts`, `src/tools/atomic/git-operations.ts`, `project_initializer.md`) -
  out of scope for a content-drafting skill.
- **HTML/CSS/JS prototype generation** (`prototype_designer.md`) - a different kind of deliverable
  than requirements text; not attempted here.
- **MCP tool support and RAG knowledge sources** - upstream's optional integrations, not ported.
