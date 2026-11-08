# Requirements entity schema

Ported from upstream's `.templates/schemas/requirement-entity-schemas.yaml`. Condensed to the fields
and rationale that matter when checking traceability during a review, rather than through a scaffold
generator. (Duplicated from `srs-draft/reference/requirements-schema.md` - each bundled skill here is
self-contained, matching the existing convention.)

## Why a dictionary, not an array

```yaml
# Required shape - keyed by ID:
functional_requirements:
  FR-AUTH-001:
    id: FR-AUTH-001
    summary: "User authentication"
    # ...
```

A dictionary gives O(1) lookup by ID, a stable key path for edits, and means reading one entity doesn't
require reading the whole array back. When reviewing, an array structure (or any entity missing from
its expected dictionary key) is itself a Structure-dimension finding.

## ID format

`<PREFIX>-<DOMAIN>-<NNN>` - uppercase domain tag, zero-padded sequence number. Numbers must be
sequential and gap-free *within* a domain+prefix pair. A gap or duplicate is exactly the kind of
"surface scan" finding this skill's three-layer method starts with - it's a cheap, reliable signal that
something was deleted, merged, or hand-edited without updating everything that referenced it.

## Entity types and their traceability field

| Prefix | YAML key | Traces back via |
|---|---|---|
| `US` | `user_stories` | `derived_fr` (forward link to the FRs it produced) |
| `UC` | `use_cases` | `derived_fr` |
| `FR` | `functional_requirements` | `source_requirements` (back to UC/US) |
| `NFR` | `non_functional_requirements` | `source_requirements` (back to FR/US) |
| `IFR` | `interface_requirements` | `source_requirements` (back to FR) |
| `DAR` | `data_requirements` | `source_requirements` (back to FR) |
| `RISK` | `risk_analysis` | `affected_requirements` (forward to whatever it threatens) |
| `ADC-ASSU`/`ADC-DEP`/`ADC-CONS` | `assumptions`/`dependencies`/`constraints` | `impacted_requirements` |

When reviewing traceability (part of the **Consistency** dimension), check both directions: every
`source_requirements`/`derived_fr`/`impacted_requirements`/`affected_requirements` entry should resolve
to an ID that actually exists in the document, and every FR should trace back to *something* (an FR
with no source is either an undocumented scope addition or a sign a use case/story went missing).
