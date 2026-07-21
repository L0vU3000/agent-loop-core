# Pipeline Categories

> Categories organize many peer pipelines for routing and policy. They do not change the
> pipeline anatomy: every pipeline still owns `explore → plan → execute → eval`, its exit
> condition, its workflow runtime, and its gitignored run state.

## Category versus pipeline

- A **category** answers: "What kind of work is this?"
- A **pipeline** answers: "Which exact workflow should handle it?"
- The **orchestrator** uses both to route an inbox item, then dispatches one pipeline.

Categories are metadata, not another directory level. Keep pipeline definitions at
`agent-loop/pipelines/<pipeline-name>/` so the dashboard, ignore rules, and machinery checks
continue to work with one stable layout.

## Categories

| Category | Purpose | Example pipelines | Default human gate |
|---|---|---|---|
| `planning` | Turn an unclear request into an approved scope, specification, or technical plan. | `spec`, `research`, `technical-plan` | Approve the output before any building pipeline starts. |
| `building` | Change the Valgate product: features, fixes, data wiring, backend entities, or interfaces. | `feature`, `bug-fix`, `entity-scaffold`, `wiring`, `migration`, `api-tool` | Approve the plan and review the finished result. |
| `review` | Inspect an existing change or surface and produce evidence-backed findings. | `code-review`, `design-review`, `security-review`, `architecture-review` | Review findings; product or design judgment stays with the owner. |
| `testing` | Improve or exercise the verification system itself, or run a dedicated health/regression pass. | `test-coverage`, `qa`, `e2e-regression` | Review quarantines, policy choices, and any product changes discovered during testing. |
| `maintenance` | Perform bounded upkeep against a measurable backlog or health signal. | `eslint-burndown`, `pipeline-improve`, `dependency-maintenance`, `performance-burndown` | May become scheduled after the pipeline proves safe and bounded. |
| `delivery` | Land, deploy, release, or monitor a verified change. | `landing`, `deploy`, `canary`, `release` | Explicit approval before irreversible or externally visible actions. |

These are the top-level categories. Add a new category only when a new kind of work needs a
different routing or safety policy; do not create a category for a single pipeline.

## Shared pipeline contract

Every pipeline, regardless of category, keeps this shape:

```text
pipelines/<pipeline-name>/
├── pipeline.md      # purpose, category, type, guardrails, and exit condition
├── explore.md       # understand the scoped work and collect evidence
├── plan.md          # decide the next bounded attempt
├── execute.md       # perform the pipeline's work
├── eval.md          # independent verifier; pass or fail on evidence
├── workflow.js      # executable stage orchestration
└── runs/            # transient per-run state; gitignored
```

The normal control flow is:

```text
explore → plan → execute → eval
            ▲                 │
            └──── fail ───────┘
                         pass → done
```

An eval failure returns to `plan` so the next attempt incorporates the verifier's evidence.
The maker and verifier remain separate agents. Plan also defines the task-specific 100-point
rubric using [`pipelines/EVAL.md`](./pipelines/EVAL.md). Eval passes only when the score reaches
the planned threshold and every critical criterion passes.

## Testing inside building pipelines

Testing required to ship a product change belongs inside that building pipeline's `eval`.
For example, a feature pipeline defines its acceptance checks, focused tests, relevant
browser flow, and regression gates as part of its own exit condition.

The `testing` category is for dedicated work whose primary product is a stronger or more
trustworthy verification signal:

- adding meaningful coverage to an untested module;
- running scoped browser QA across a surface;
- repairing or classifying the end-to-end regression suite;
- scheduled or release-level verification that is broader than one building pipeline.

The orchestrator must not dispatch every standalone testing pipeline after every build.
It chooses the checks embedded in the selected building pipeline, and reserves testing
pipelines for explicit test-health, QA, regression, or release work items.

## Routing metadata

Every `pipeline.md` begins with:

```yaml
---
name: feature
category: building
type: feature
---
```

New inbox items identify both the category and the requested type:

```yaml
---
category: building
type: feature
priority: normal
created: YYYY-MM-DD
---
```

The orchestrator validates the pair against its registry. If a future factory-router accepts
an unspecified type, it may use the category to narrow candidates before selecting a pipeline.
Until then, `type` remains the exact routing key.

## Current pipelines

| Category | Type | Pipeline |
|---|---|---|
| `planning` | `spec` | `spec` |
| `planning` | `research` | `research` |
| `planning` | `technical-plan` | `technical-plan` |
| `building` | `bug` | `bug-fix` |
| `building` | `feature` | `feature` |
| `building` | `entity` | `entity-scaffold` |
| `building` | `wiring` | `wiring` |
| `building` | `migration` | `migration` |
| `building` | `api-tool` | `api-tool` |
| `testing` | `test` | `test-coverage` |
| `testing` | `qa` | `qa` |
| `testing` | `e2e` | `e2e-regression` |
| `maintenance` | `lint` | `eslint-burndown` |
| `maintenance` | `pipeline-improve` | `pipeline-improve` |
| `maintenance` | `dependency` | `dependency-maintenance` |
| `maintenance` | `perf` | `performance-burndown` |
| `review` | `code-review` | `code-review` |
| `review` | `design-review` | `design-review` |
| `review` | `security-review` | `security-review` |
| `review` | `architecture-review` | `architecture-review` |
| `delivery` | `landing` | `landing` |
| `delivery` | `deploy` | `deploy` |
| `delivery` | `canary` | `canary` |
| `delivery` | `release` | `release` |

Delivery now has four approval-gated wrappers: `landing`, `deploy`, `canary`, and `release`.
They delegate domain work to installed delivery capabilities and keep merge, deployment, rollback,
production, and final release decisions behind explicit owner gates. Planning has `spec`,
`research`, and `technical-plan`; review has `code-review`, `design-review`, `security-review`, and
`architecture-review`; maintenance has `dependency-maintenance` and `performance-burndown` alongside
its two proven pipelines. The new delivery and maintenance pipelines are authored in locked training
mode and await genuine work before proof.
`entity-scaffold` is registered but remains in training mode until an approved entity ticket
completes its first real run. `pipeline-improve` remains human-gated after every Plan.
