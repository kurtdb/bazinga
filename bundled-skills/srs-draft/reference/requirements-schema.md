# Requirements entity schema

Ported from upstream's `.templates/schemas/requirement-entity-schemas.yaml`. Condensed to the fields
and rationale that matter when hand-writing these by hand in a skill, rather than through a scaffold
generator.

## Why a dictionary, not an array

```yaml
# Required shape - keyed by ID:
functional_requirements:
  FR-AUTH-001:
    id: FR-AUTH-001
    summary: "User authentication"
    # ...

# Not this - a list you'd have to scan to find one entry:
functional_requirements:
  - id: FR-AUTH-001
    summary: "User authentication"
```

Reasons this matters in practice, not just style: a dictionary gives O(1) lookup by ID instead of a
linear scan, a stable key path for later edits (`functional_requirements.FR-AUTH-001.summary` never
shifts when another entry is added or removed, the way an array index would), and it means reading or
updating one entity doesn't require reading the whole array back.

## ID format

`<PREFIX>-<DOMAIN>-<NNN>` - a short, stable, uppercase domain tag (pick one per feature area and reuse
it across every entity type touching that area, e.g. `AUTH`, `PAYMENTS`, `SEARCH`), then a
zero-padded sequence number. Numbers don't need to be globally sequential across domains, only
sequential and gap-free *within* a domain+prefix pair (a reviewer checks for gaps as a cheap proxy for
"something got deleted without updating references").

## Entity types

| Prefix | YAML key | Holds |
|---|---|---|
| `US` | `user_stories` | As a/I want to/so that, with acceptance criteria |
| `UC` | `use_cases` | Actor, pre/postconditions, main scenario, extensions |
| `FR` | `functional_requirements` | Atomic, testable system behavior |
| `NFR` | `non_functional_requirements` | Quality attributes with a measurable target |
| `IFR` | `interface_requirements` | API/UI/DB/file interface shape |
| `DAR` | `data_requirements` | Data entities, attributes, validation rules |
| `RISK` | `risk_analysis` | Probability/impact/mitigation/contingency |
| `ADC-ASSU`/`ADC-DEP`/`ADC-CONS` | `assumptions`/`dependencies`/`constraints` | What the document rests on |

Every entity carries `source_requirements: []` (or the type-specific traceability field below) pointing
at the ID(s) it derives from, and a small `metadata` block: `{ status: draft, version: '1.0' }`.

## Field shapes (worked examples, generic/non-proprietary - safe to reuse as-is)

### User Story

```yaml
user_stories:
  US-LOGIN-001:
    id: US-LOGIN-001
    summary: "User login functionality"
    epic: "Epic 1"
    description: ["As a registered user, I want to log in..."]
    as_a: ["registered user"]
    i_want_to: ["log in to my account"]
    so_that: ["I can access personalized features"]
    acceptance_criteria: ["User enters valid credentials", "System authenticates user"]
    derived_fr: ["FR-AUTH-001", "FR-AUTH-002"]
    metadata: { status: draft, version: '1.0' }
```

### Use Case

```yaml
use_cases:
  UC-LOGIN-001:
    id: UC-LOGIN-001
    summary: "User authentication process"
    description: ["This use case describes..."]
    actor: ["End User", "Authentication Service"]
    preconditions: ["User has valid credentials"]
    postconditions: ["User is authenticated"]
    main_success_scenario: ["1. User enters credentials", "2. System validates"]
    extensions: ["1a. Invalid credentials"]
    derived_fr: ["FR-AUTH-001"]
    metadata: { status: draft, version: '1.0' }
```

### Functional Requirement

```yaml
functional_requirements:
  FR-AUTH-001:
    id: FR-AUTH-001
    summary: "User authentication via username and password"
    description: ["The system shall authenticate users..."]
    priority: high  # enum: critical/high/medium/low
    source_requirements: ["UC-LOGIN-001", "US-LOGIN-001"]
    acceptance_criteria: ["System validates credentials", "System creates session"]
    metadata: { status: draft, version: '1.0' }
```

### Non-Functional Requirement

```yaml
non_functional_requirements:
  NFR-PERF-001:
    id: NFR-PERF-001
    summary: "Login response time requirement"
    category: performance  # enum: performance/security/reliability/maintainability/
                            #       portability/compatibility/usability/scalability/
                            #       availability/compliance
    description: ["The system shall respond to login requests within 2 seconds"]
    target_measure:
      - metric: "Response time"
        target_value: "< 2 seconds"
    priority: high
    source_requirements: ["FR-AUTH-001"]
    metadata: { status: draft, version: '1.0' }
```

### Interface Requirement

```yaml
interface_requirements:
  IFR-API-001:
    id: IFR-API-001
    summary: "User authentication API endpoint"
    description: ["REST API endpoint for user authentication"]
    interface_type: api  # enum: api/ui/database/file/other
    input_data: ["username: string", "password: string"]
    output_data: ["token: string", "userId: string", "status: integer"]
    core_validation_rules: ["Username must be non-empty", "Password must meet complexity requirements"]
    source_requirements: ["FR-AUTH-001"]
    metadata: { status: draft, version: '1.0' }
```

### Data Requirement

```yaml
data_requirements:
  DAR-USER-001:
    id: DAR-USER-001
    summary: "User account data structure"
    description: ["Defines the user account data entity"]
    data_entity: ["User"]
    core_attributes: ["userId: UUID", "username: string", "passwordHash: string", "email: string"]
    core_validation_rules: ["userId must be unique", "Username must be 3-20 characters"]
    source_requirements: ["FR-AUTH-001"]
    metadata: { status: draft, version: '1.0' }
```

### Risk

```yaml
risk_analysis:
  RISK-001:
    id: RISK-001
    summary: "Authentication service dependency risk"
    category: technical  # enum: technical/business/operational/external/resource/schedule/
                          #       financial/compliance
    phase: implementation  # enum: requirements/design/implementation/testing/deployment/maintenance
    description: ["Third-party authentication service may become unavailable"]
    probability: medium  # enum: high/medium/low
    impact: high  # enum: critical/high/medium/low
    risk_score: high  # enum: critical/high/medium/low
    affected_requirements:
      functional_requirements: ["FR-AUTH-001", "FR-AUTH-002"]
      non_functional_requirements: ["NFR-AVAIL-001"]
    mitigation_strategy:
      approach: preventive  # enum: preventive/detective/corrective
      actions: ["Implement fallback authentication", "Add health check monitoring"]
      success_criteria: ["Fallback activates within 30 seconds", "Zero user impact"]
    contingency_plan:
      trigger_condition: "Service unavailable for > 10 minutes"
      actions: ["Activate local authentication", "Notify users"]
      recovery_time: "< 15 minutes"
    residual_risk: low  # enum: critical/high/medium/low
    status: identified  # enum: identified/assessed/mitigated/monitoring/closed/materialized
    metadata: { status: draft, version: '1.0' }
```

### Assumption (one of the three ADC types - dependencies/constraints follow the same shape)

```yaml
assumptions:
  ADC-ASSU-001:
    id: ADC-ASSU-001
    summary: "Third-party authentication service availability"
    assumptions: ["OAuth provider maintains 99.9% uptime"]
    risk_if_false: ["Users cannot log in", "System becomes unavailable"]
    impacted_requirements: ["FR-AUTH-001", "NFR-AVAIL-001"]
    validation_method: ["Monitor service SLA reports", "Set up health checks"]
    metadata: { status: draft, version: '1.0' }
```
