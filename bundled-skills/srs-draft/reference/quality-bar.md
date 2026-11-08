# Quality bar for drafting

Translated and adapted from upstream's `rules/base/quality-guidelines.md` (originally Chinese) and the
self-review table in `rules/base/content-specialist-workflow.md`. Apply this during each section's
Self-Review step in `srs-draft/SKILL.md`, before showing the section to the user.

## Self-check table (run per section, before showing it)

| Check | Fails if... |
|---|---|
| **Completeness** | A required field for this section type (see `section-templates.md`) is missing or left as a placeholder bracket. |
| **Testability** | An acceptance criterion or NFR target can't be turned into a pass/fail test as written. |
| **Traceability** | An entity references an ID that doesn't exist yet, or has no source/derived link at all when one is expected. |
| **Consistency** | The same concept is named two different ways across sections, or a term in the glossary-in-progress is used with a different meaning here. |
| **INVEST (user stories only)** | Independent, Negotiable, Valuable, Estimable, Small, Testable - a story that fails any of these should be split or reworked, not shipped as-is. |

Fix every ❌ before moving on; don't carry a known gap forward hoping it gets caught later.

## Scoring bands, if you need to communicate confidence to the user

Use these only when you genuinely need to flag "I'm not sure about this part" - don't attach a score to
every sentence.

**Completeness** (does this section cover everything the type requires):
- 90-100%: everything required is present
- 70-89%: mostly complete, minor gaps
- below 70%: say so explicitly and ask, don't ship it labeled otherwise

**Confidence** (how sure you are the content is accurate, not invented):
- 90-100%: directly stated by the user or unambiguously implied
- 70-89%: a reasonable inference from what was said - flag the inference in your approval-gate question
  so the user can correct it
- below 70%: this is a guess - don't write it into the document; ask instead

## Common pitfalls to avoid

1. **Vague content** - "the system should be fast" instead of a measurable target. Push back on
   adjectives that aren't backed by a number.
2. **Mixed terminology** - using "user," "customer," and "member" interchangeably for what's actually
   one role. Pick one term per concept and hold it for the whole document.
3. **Logic jumps** - a use case that skips from precondition straight to postcondition with no
   main-success-scenario steps in between.
4. **Format drift** - one FR using the acceptance-criteria checklist style and another using a prose
   paragraph. Match the skeleton in `section-templates.md` every time.
5. **Redundant information** - restating the same constraint in both Overall Description and Business
   Rules & Constraints instead of stating it once and cross-referencing it.

## Section-specific emphasis

- **Summary**: stays short (a few sentences, not a page) and written for someone deciding whether to
  read further, not for someone who already knows the project.
- **Functional Requirements**: precise and unambiguous above all - this is the one section most likely
  to be read literally by whoever implements it.
- **Non-Functional Requirements**: every metric needs a unit and a verification method, or it isn't
  done yet.
- **User Journeys / Use Cases**: should reflect how a user actually behaves, not an idealized path -
  the alternative/extension flows matter as much as the main scenario.
