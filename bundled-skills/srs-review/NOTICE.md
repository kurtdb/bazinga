# Notice

This skill is a derivative, standalone port of the SRS Reviewer specialist's rules from Testany's SRS
Writer, https://github.com/Testany-io/srs-writer-plugin
(`rules/specialists/process/srs_reviewer.md`), licensed under the Apache License, Version 2.0 (see
LICENSE in this folder). That repository is archived/read-only; the port is based on its `main` branch
as of 2026-11-07. The source file is written in Chinese; this skill is a **translated and adapted**
version, not a literal copy.

This is not an officially supported Testany product. For the full extension, install it the way
upstream intends: https://marketplace.visualstudio.com/items?itemName=Testany.srs-writer-plugin

## What this port keeps

- The reviewer's mindset directives, close to upstream's own wording in spirit: assume the document has
  problems and your job is to find them; don't be fooled by polish; most AI-written SRS should score
  6-8/10, not 9-10.
- The three-layer review method (surface scan / logic validation / critical analysis) and its specific
  checklists (hidden technical risk, business-logic traps, AI-generation tells).
- The **real** weighted scoring rubric from the rules file as it actually is today - Completeness 25%,
  Clarity 20%, Feasibility 15%, Consistency 15%, Structure 15%, Business Value 10% - rather than the
  marketplace listing's description of "7 dimensions including an AI Quality dimension," which doesn't
  match this rules file (the listing's own specialist counts are self-admittedly inconsistent elsewhere
  too - see the research behind this port).
- The scoring decision tree, grade bands, and the weighted-score worked example.
- The report structure (overview, P0/P1/P2 findings, scoring table, improvement roadmap).

## What this port drops, and why

- **The custom specialist registration/config block** (`specialist_config` YAML frontmatter:
  `iteration_config`, `template_config`, capability tags) - this configures upstream's own specialist
  registry (`src/core/specialistRegistry.ts`); meaningless once ported to a plain skill file.
- **Upstream's own file-naming/timestamp convention**
  (`srs_review_report_${projectName}_${timestamp}.md`) - simplified to a fixed `srs_review_report.md`,
  since this skill has no session/project-ID system to template into a filename.
- **"Special situation" handling for team seniority/project phase** (a short section in the original
  tuning review strictness for MVP vs. large projects, junior vs. senior teams) - judged to add more
  complexity than value for a skill meant to give one consistent, strict read regardless of audience;
  the reviewer should stay strict and let the user weigh urgency/team context themselves when deciding
  what to fix first.

## Added, not in upstream

- The **fresh-eyes dispatch instruction** (run as a separate Agent-tool sub-agent when following
  straight after drafting in the same conversation) is this port's addition, not upstream's - upstream
  has its own session/specialist-isolation model that already keeps the reviewer specialist's context
  separate from the content specialists' by construction. Ported the *intent* (an unbiased, polish-proof
  reader) using the mechanism Bazinga actually has available for it, the same way
  `bundled-skills/egm-review/NOTICE.md` documents doing for EGM's reviewer personas.
