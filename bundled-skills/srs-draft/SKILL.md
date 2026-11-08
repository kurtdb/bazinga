---
name: srs-draft
license: Apache-2.0
description: "Drafts a Software Requirements Specification (SRS.md) and a traceable requirements.yaml from a plain-language feature description or existing notes, section by section, asking before it ever fabricates a detail. Use when the user wants to write, scaffold, or flesh out requirements/an SRS for a feature or project."
---

# SRS Drafting

> **Standalone port, not the original plugin.** This skill carries over the requirement-drafting
> workflow and entity schema from [Testany's SRS Writer](https://marketplace.visualstudio.com/items?itemName=Testany.srs-writer-plugin)
> ([source](https://github.com/Testany-io/srs-writer-plugin), Apache-2.0) - bundled with Bazinga as a
> plain skill folder, no plugin install needed. It does **not** include that extension's VS Code chat
> integration, its 12-specialist fan-out engine, git automation, or HTML/CSS/JS prototype generation -
> see `NOTICE.md` for exactly what was kept and dropped. For the full extension (native VS Code chat
> integration, multi-turn specialist dialogue, project/session management), install it the way upstream
> intends.

Drafts a Software Requirements Specification one section at a time, writing both a readable `SRS.md`
and a machine-traceable `requirements.yaml` as it goes. The single rule that matters most: **never
invent a detail the user hasn't given you** - ask instead.

## Inputs

- A plain-language description of the feature or project ("a bookmarking feature for a recipe app"),
  or an existing `discussion_summary.md`/`design_draft.md`/rough notes to formalize.
- An existing `SRS.md`/`requirements.yaml` in the project, if there is one - this skill updates and
  extends it rather than overwriting it.

## Step 1: Read before you write

Before drafting anything, check the project for an existing `SRS.md` and `requirements.yaml` and read
them if present. Do not assume their contents from memory or from what the user describes - documents
drift from descriptions, and a stale assumption here corrupts every ID and traceability link that
follows. If neither file exists, this is a fresh document; say so and confirm the feature/project scope
with the user before drafting the first section.

## Step 2: Draft section by section, in this order

1. **Summary** - what this is and why it matters, in plain language, short (a few sentences, not a
   page).
2. **Overall Description** - system context: who/what this fits into, major constraints, assumed
   environment.
3. **User Stories** - `As a / I want to / so that` plus acceptance criteria. See
   `reference/section-templates.md`.
4. **Use Cases** - actor, preconditions, postconditions, main success scenario, extensions
   (alternative/error flows). One use case can satisfy several user stories; link both ways.
5. **Functional Requirements (FR)** - atomic, testable "the system shall..." statements, each traceable
   to the use case(s)/story(ies) it came from. The test for "atomic enough": could a reviewer write a
   single pass/fail test case from this FR and its acceptance criteria alone? If not, split it.
6. **Non-Functional Requirements (NFR)** - quality attributes (performance, security, reliability,
   usability, etc.) with a concrete, measurable target, not an adjective. "Fast" is not an NFR; "95th
   percentile response time under 500ms at 1000 concurrent users" is.
7. **Interface & Data Requirements (IFR / DAR)** - API/UI/file/database interface shapes, and the data
   entities and their key attributes/validation rules, each traced back to the FR that needs them.
8. **Business Rules & Constraints (ADC)** - the assumptions, dependencies, and hard constraints the
   whole document rests on, each with what breaks if the assumption turns out false.
9. **Risks & Assumptions (RISK)** - what could go wrong, how likely, how bad, and what the mitigation
   is, for anything flagged as uncertain while drafting the sections above.
10. **Glossary** - every domain term used in a way a new reader couldn't guess, defined once.

Skip a section outright (don't pad it) if the user says it doesn't apply to this project - a thin
command-line tool doesn't need a UI interface-requirements section, for instance. Note the skip in the
document rather than silently omitting it, so a reviewer doesn't mistake "skipped" for "forgotten."

### For each section: Plan, Draft, Self-Review

1. **Plan** (internal, don't show this to the user): list the sub-points and requirement IDs you're
   about to write, and anything you're missing to write them well.
2. **Draft**: write the section in full, following `reference/section-templates.md`'s skeleton for that
   section type.
3. **Self-Review** before showing it, against this checklist - fix anything unchecked, don't ship it
   unchecked:
   - **Completeness** - does it cover what the section type requires (see
     `reference/quality-bar.md`)?
   - **Testability** - for requirements/acceptance criteria, could someone write a pass/fail test from
     this alone?
   - **Traceability** - does every entity reference a real, already-assigned ID? No forward references
     to IDs that don't exist yet.
   - **Consistency** - same term, same meaning, as every earlier section (check the glossary-in-progress
     if one term could mean two things).
   - **No invented specifics** - every concrete number, name, or constraint traces back to something the
     user said, not to a plausible-sounding guess. If you need one to finish the section, stop and ask;
     mark the gap `[INFO-NEEDED: <specific question>]` in your question to the user, never in the
     shipped document.

### Approval gate

After drafting a section, show it in chat (and confirm it's been written to `SRS.md` /
`requirements.yaml`), then ask in plain language: *"Drafted [section]. Approve and move to the next
section, or revise?"* On a revision request, apply it, re-run the self-review, and ask again. On
approval, continue to the next section. Don't draft two sections ahead of an unapproved one - a rejected
assumption in an early section (e.g. "actually there's no login, it's anonymous") can invalidate work
already done on a later one.

## Step 3: Write requirements.yaml alongside SRS.md

Every entity introduced in `SRS.md` gets a matching entry in `requirements.yaml`, keyed by ID (a
**dictionary**, never an array - see `reference/requirements-schema.md` for why and for the exact field
shape per entity type). Assign IDs in the form `<PREFIX>-<DOMAIN>-<NNN>` (e.g. `FR-AUTH-001`,
`NFR-PERF-001`) using a short, stable uppercase domain tag you pick once per feature area and reuse
consistently. Populate each entity's `source_requirements` (what it derives from) so the whole document
is traceable end to end - from user story down to data requirement - without re-reading prose to find
the connection.

## Step 4: Hand off

Once every section is approved, tell the user the document is complete and recommend running
`srs-review` against it for a critical pass before treating it as final - this skill's own self-review
catches gaps and inconsistency, but not a skeptical outside read of whether the requirements are any
good, which is a different, harder job on purpose (see `srs-review`'s `SKILL.md` for why that needs a
fresh, un-anchored reader rather than the session that just wrote the thing).

## Reference material

- `reference/requirements-schema.md` - entity types, ID format, and the `requirements.yaml` shape.
- `reference/section-templates.md` - the skeleton for each `SRS.md` section.
- `reference/quality-bar.md` - the completeness/testability/confidence bars and common pitfalls to
  avoid.
