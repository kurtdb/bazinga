# Section skeletons

Condensed from upstream's `.templates/*/*_template.md` - the structural skeleton for each `SRS.md`
section, trimmed of the full upstream prose/examples but keeping every field that carries real
information. Fill in every bracket; don't leave a placeholder in the shipped document, and don't add
a field just because a template has it if the project genuinely has nothing to say there - see
`srs-draft/SKILL.md`'s rule about noting a skip rather than padding.

## Summary

```markdown
## Summary

**Purpose**: [what this is and the primary business objective it serves]
**Scope**: In scope - [...]. Out of scope - [...]. Future considerations - [...].
**Business problem**: [the problem or opportunity driving this]
**Solution overview**: [one paragraph: the approach, in plain language]
**Success criteria**: [a short numbered list of what "done and working" looks like]
```

## Overall Description

```markdown
## Overall Description

**System context**: [what this fits into - existing systems, integrations, environment]
**Users and stakeholders**: [who uses this and who else cares about it]
**Constraints**: [hard limits - budget, timeline, must-use-this-stack, regulatory, etc.]
**Assumptions**: [anything taken as given that, if wrong, changes the design]
```

## User Stories

```markdown
### Epic - [Epic name]

**Epic description**: [what this group of stories accomplishes]

#### US-[DOMAIN]-NNN: [Story title]
- **As**: [user role]
- **I want**: [desired functionality]
- **So that**: [business value]
- **Acceptance criteria**: 1. [...] 2. [...]
- **Priority**: critical/high/medium/low
- **Dependencies**: [US-...] or none
```

## Use Cases

```markdown
#### UC-[DOMAIN]-NNN: [Use case title]
- **Primary actor**: [role] | **Secondary actors**: [roles, if any]
- **Description**: [one line]
- **Priority**: critical/high/medium/low
- **Preconditions**: 1. [...]
- **Main success scenario**: 1. [actor action] 2. [system response] ...
- **Extensions/alternative flows**: E1: at step [N], if [condition], then [behavior]. A1: [actor] may
  instead [alternative].
- **Postconditions**: Success - [...]. Failure - [...].
- **Relationships**: Includes [UC-...] | Extends [UC-...]
```

Include a use-case summary table (`| Use Case ID | Name | Primary actor | Priority |`) once all use
cases for a feature area are drafted - it's the fastest way for a reviewer to sanity-check coverage.

## Functional Requirements

```markdown
#### FR-[DOMAIN]-NNN: [Requirement title]
- **Priority**: critical/high/medium/low
- **Source**: [UC-..., US-...]
- **Description**: [the system shall...]
- **Acceptance criteria**:
    - [ ] Normal: [...]
    - [ ] Boundary: [...]
    - [ ] Exception: [...]
    - [ ] Security (if applicable): [...]
- **Dependencies**: [FR-...] or none
```

Acceptance criteria should cover at minimum one normal-path and one boundary/exception case - an FR
with only a happy-path criterion hasn't actually specified the hard part.

## Non-Functional Requirements

```markdown
#### NFR-[CATEGORY]-NNN: [Requirement title]
- **Category**: performance/security/reliability/maintainability/portability/compatibility/usability/
  scalability/availability/compliance
- **Priority**: critical/high/medium/low
- **Description**: [the system shall...]
- **Metric**: [name] - **Target**: [value with unit - never an adjective]
- **Verification method**: [how this gets tested/measured]
- **Source**: [FR-..., US-...]
```

A metric with no unit or no way to verify it isn't an NFR yet - push back and ask for one, don't invent
a plausible-sounding number.

## Interface & Data Requirements

```markdown
#### IFR-[DOMAIN]-NNN: [Interface title]
- **Type**: api/ui/database/file/other
- **Input**: [field: type, ...] | **Output**: [field: type, ...]
- **Validation rules**: [...]
- **Source**: [FR-...]

#### DAR-[DOMAIN]-NNN: [Data entity title]
- **Entity**: [name]
- **Attributes**: [field: type, ...]
- **Validation rules**: [...]
- **Source**: [FR-...]
```

## Business Rules & Constraints

```markdown
#### ADC-[ASSU|DEP|CONS]-NNN: [Title]
- **Statement**: [the assumption/dependency/constraint itself]
- **Risk if false/unmet**: [what breaks]
- **Impacted requirements**: [FR-..., NFR-...]
- **Validation method**: [how/when this gets checked, if it can be]
```

## Risks & Assumptions

```markdown
#### RISK-NNN: [Risk title]
- **Category**: technical/business/operational/external/resource/schedule/financial/compliance
- **Probability**: high/medium/low | **Impact**: critical/high/medium/low
- **Description**: [what could go wrong]
- **Affected requirements**: [FR-..., NFR-...]
- **Mitigation**: [preventive action(s)]
- **Contingency**: [trigger condition] -> [response]
```

## Glossary

```markdown
| Term | Definition | First used in |
|---|---|---|
| [term] | [one clear sentence - no circular definitions using other undefined terms] | [FR-.../section] |
```

Only terms a new reader couldn't guess from context, or that are used in a way narrower/different than
their everyday meaning. A glossary padded with obvious terms is as unhelpful as a missing one.
