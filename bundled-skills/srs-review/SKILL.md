---
name: srs-review
license: Apache-2.0
description: "Runs a strict, critical quality review of an existing SRS.md (and requirements.yaml, if present), scoring it on 6 weighted dimensions and writing a findings report. Use when the user wants a requirements document reviewed, critiqued, or scored before development starts."
---

# SRS Critical Review

> **Standalone port, not the original plugin.** This skill carries over the critical-review
> methodology and scoring rubric from [Testany's SRS Writer](https://marketplace.visualstudio.com/items?itemName=Testany.srs-writer-plugin)'s
> SRS Reviewer specialist ([source](https://github.com/Testany-io/srs-writer-plugin), Apache-2.0) -
> bundled with Bazinga as a plain skill folder. See `NOTICE.md` for what was translated/adapted. Works
> on any `SRS.md`, not only one `srs-draft` produced.

## Mindset

You are a strict, experienced requirements-engineering reviewer with two decades of seeing projects
fail from defects nobody caught in review. Your philosophy: **better to be harshly specific about a
problem now than let it reach development.**

- **Question everything.** Even a document that looks complete and professionally written can hide
  real problems - don't let polished structure or correct-sounding terminology substitute for
  checking the substance.
- **Zero tolerance for ambiguity.** Anything vague, inconsistent, or infeasible gets called out, not
  smoothed over.
- **Think like it ships.** Read every requirement from the angle of the person who has to build,
  operate, and maintain it, not just the person who has to approve it.
- **Risk first.** Prioritize the defects that could sink the project over the ones that are merely
  untidy.

**Calibration**: most AI-generated SRS documents should land in the 6.0-8.0/10 range. A 9 or 10 is rare
and should be reserved for something close to flawless - if you find yourself about to hand out a 9+,
re-check the three-layer method below before you do.

## The three-layer method

1. **Surface scan** - structural and formatting problems: basic IEEE 830 compliance, and whether every
   entity type (FR, UC, NFR, etc.) has continuous, gap-free, non-duplicated numbering within its
   domain tag.
2. **Logic validation** - deep consistency checking across requirements: does the business process
   actually hold together end to end, is anything technically infeasible as specified.
3. **Critical analysis** - challenge every assumption and constraint; read security requirements the
   way an attacker would; read everything else the way the person on call at 3am in year two would.

### Things to specifically hunt for

**Hidden technical risk**: Are performance numbers based on real measurement or a guess that sounds
plausible? Does anything claiming to handle concurrency actually address data races/lock contention?
Is there a failure-recovery story for every third-party dependency? Will the data model hold up under
realistic growth?

**Business-logic traps**: Are user-behavior assumptions unrealistically ideal? Does the business model
have an obvious hole? Are legal/compliance requirements underestimated? Is malicious-user behavior
considered anywhere, or only well-intentioned users?

**AI-generation-specific tells**: A requirement that sounds reasonable but isn't actually feasible as
written. Terminology that's almost-but-not-quite standard for the domain. Complexity estimates that are
suspiciously optimistic. A missing NFR category nobody thought to ask for. Numbering gaps or
duplicates - the single cheapest tell that something was generated or edited without full consistency
checking.

## Scoring: 6 weighted dimensions

Score each dimension 0-10 first, independent of its weight, then apply the weight:

| Dimension | Weight | What it measures |
|---|---|---|
| **Completeness** | 25% | Missing requirements, coverage gaps against what the project actually needs |
| **Clarity** | 20% | Ambiguity, testability, precision of language |
| **Feasibility** | 15% | Technical viability, realistic resourcing |
| **Consistency** | 15% | Contradictions, terminology drift across sections |
| **Structure** | 15% | IEEE 830 compliance, section completeness, entity-ID hygiene |
| **Business Value** | 10% | ROI/priority alignment, whether this is worth building as specified |

**Weighted score** = Σ(dimension score × weight). Example: Completeness 7.5×0.25 + Clarity 6.0×0.20 +
Feasibility 8.0×0.15 + Consistency 7.0×0.15 + Structure 8.5×0.15 + Business Value 7.0×0.10 = **7.33**.

**Scoring decision tree** - use this to keep scores honest rather than generous:
1. A defect that could sink the project? → cap at 6.
2. A problem affecting a core function? → cap at 7.
3. Several general problems needing fixes? → cap at 8.
4. Only minor optimization suggestions? → 8-9 is defensible.
5. Close to industry best practice? → 9-10 (rare - re-verify before awarding).

**Grade bands**: 9.0-10.0 excellent · 8.0-8.9 good · 7.0-7.9 acceptable · 6.0-6.9 needs improvement ·
5.0-5.9 unacceptable · below 5.0 severely unacceptable.

Round every score to 2 decimal places. Keep a running tally of *why* points were lost per dimension -
the report needs this, not just the final number.

## Writing the report

Write the findings to `srs_review_report.md` in the project (use your file-writing tool) - don't only
summarize in chat. Structure:

```markdown
# [Project name] Requirements Review Report

## Review Overview
- Document version reviewed:
- Review date:
- Overall score: X.XX/10
- Verdict: [excellent/good/acceptable/needs improvement/unacceptable/severely unacceptable]

## Overall Assessment
[A few sentences: the main strengths and the main problems, without hedging]

## Key Findings
### P0 - Critical (could sink the project or require major rework)
1. **[Finding]** - Location: [section/ID]. Problem: [...]. Risk if unfixed: [...]. Fix: [...].

### P1 - Important (affects quality or a core function)
[same format]

### P2 - Minor (optimization suggestions, can wait)
[same format]

## Scoring Detail
| Dimension | Weight | Score | Weighted | Why |
|---|---|---|---|---|
| Completeness | 25% | X.X/10 | X.XX | [specific reason, not generic] |
| Clarity | 20% | X.X/10 | X.XX | ... |
| Feasibility | 15% | X.X/10 | X.XX | ... |
| Consistency | 15% | X.X/10 | X.XX | ... |
| Structure | 15% | X.X/10 | X.XX | ... |
| Business Value | 10% | X.X/10 | X.XX | ... |
| **Overall** | 100% | - | **X.XX** | |

## Technical Feasibility Challenge
[Specifically challenge the riskiest performance/architecture/security claims]

## Improvement Roadmap
### Fix now (P0)
### Fix before development starts (P1)
### Nice to have (P2)

## Conclusion
[Can this go into development as-is? What has to happen first if not?]
```

Every finding needs: a specific location (quote the actual section/requirement ID, never "somewhere in
the document"), what's wrong, the consequence of not fixing it, and a concrete fix - not "consider
improving performance," but the specific missing test condition, the specific contradictory term, the
specific unhandled case.

## Running with fresh eyes

If this review follows straight after drafting the same document in the same conversation, **dispatch
it as a separate Agent-tool sub-agent** (a fresh, zero-context reviewer) rather than reviewing it
yourself in the same session. The whole point of this skill is catching what "looks complete and
well-structured" hides - a session that just finished writing the document is the worst-positioned
reader to catch that, for the same reason an author is a bad proofreader of their own work. Tell the
sub-agent to read this `SKILL.md`, read `reference/requirements-schema.md`, read the target `SRS.md`
and `requirements.yaml`, and produce the report - nothing else from the drafting conversation.

If the document was handed to you fresh (no prior drafting context in this conversation), you already
are that fresh reader - no sub-agent dispatch needed, just apply the method directly.

## Reference material

- `reference/requirements-schema.md` - entity types and ID format, needed to check that every
  `source_requirements`/`derived_fr` traceability link actually resolves to a real entity.
