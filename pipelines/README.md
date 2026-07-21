# Pipelines

> Each pipeline is one **AI Developer Workflow (ADW)**: a folder that takes a work item and
> runs it through four stages — **explore → plan → execute → eval** — looping on the
> `eval-fails → plan` edge until the exit condition is met.

The [orchestrator](../orchestrator/orchestrator.md) routes work here. The
[category contract](../categories.md) groups peer pipelines without changing their anatomy.
The [skills library](../skills-library.md) provides the engines that run each stage.

All pipelines use the shared [Eval scoring guide](./EVAL.md): Plan writes a task-specific
100-point rubric before Execute, and the independent Eval agent applies it to evidence. A run
passes only when it reaches the planned threshold and has zero critical failures.

## The four stages (separate agents — do NOT collapse into one skill)

| Stage | Role | Context | Reads / Writes |
|---|---|---|---|
| `explore.md` | scout — understand the work, categorize it | read-only | writes findings to `runs/<id>/` |
| `plan.md` | decide the approach + task-specific Eval rubric | read-only | writes a plan and 100-point scorecard to `runs/<id>/` |
| `execute.md` | **MAKER** — make the change | read-write, in a worktree | edits code |
| `eval.md` | **VERIFIER** — decide pass/fail | read-only | pass → done; fail → back to `plan` |

**The maker≠verifier rule is load-bearing.** `execute` and `eval` must be *different*
agents. The verifier checks facts, cites evidence (the command + its output), and **never
suggests fixes** — it only rules pass/fail. That's the whole reason a loop can run
unattended without lying to itself.

## Definition vs. run-state

- The stage files (`*.md`) are the **definition** — the prompts, committed to git.
- `runs/` holds the **transient state of one execution** — findings, plans, logs. It is
  **gitignored** (`agent-loop/pipelines/*/runs/`). Never mix the two.

## Anatomy checklist (every pipeline must have)

- [ ] a **goal** with a machine-checkable **exit condition** (in `pipeline.md`)
- [ ] `name`, `category`, and routing `type` metadata (in `pipeline.md` frontmatter)
- [ ] an `eval` stage that is a **separate verifier** citing evidence
- [ ] a Plan-authored **100-point Eval rubric** whose weights total 100, threshold is 80–100,
      and safety/regression gates are critical
- [ ] **guardrails**: worktree isolation; Neon dev branch (never prod / `seed:reset`)
- [ ] **bounds**: max-iterations / max-time
- [ ] **memory**: failures logged to [`../memory/errors.md`](../memory/errors.md)

## Pipelines

| Category | Pipeline | Type | Status |
|---|---|---|---|
| `maintenance` | [`eslint-burndown`](./eslint-burndown/pipeline.md) | `lint` | ✅ automated (Workflow), proven |
| `building` | [`bug-fix`](./bug-fix/pipeline.md) | `bug` | ✅ proven by hand and automated on the co-owner data-loss ticket |
| `building` | [`feature`](./feature/pipeline.md) | `feature` | ✅ proven by hand — Sole-Ownership confirmed cleanup, acceptance tests red→green |
| `building` | [`entity-scaffold`](./entity-scaffold/pipeline.md) | `entity` | authored — training mode; proof waits for an approved ordinary property-child entity |
| `testing` | [`test-coverage`](./test-coverage/pipeline.md) | `test` | ✅ proven by hand — `portfolio-shared.ts` 0%→100% coverage, 100% mutation score |
| `testing` | [`qa`](./qa/pipeline.md) | `qa` | ✅ proven by hand — 8/8 flows; WebGL crash + duplicate React key fixed; 183/183 global tests |
| `testing` | [`e2e-regression`](./e2e-regression/pipeline.md) | `e2e` | ✅ proven by hand — run `2026-07-16-030754`: 9 failures triaged (Agentation-in-DEMO fixed, `/activity` scope-cut, P3/C3/F5 contract fixes, 5 wizard/bulk-bar flakes quarantined+ticketed); 2× green |
| `maintenance` | [`pipeline-improve`](./pipeline-improve/pipeline.md) | `pipeline-improve` | ✅ proven by hand — registry drift rejected across 4 sources; 195/195 global tests |
| `maintenance` | [`dependency-maintenance`](./dependency-maintenance/pipeline.md) | `dependency` | authored — approval-gated npm backlog batches; first proof waits for a genuine dependency item |
| `maintenance` | [`performance-burndown`](./performance-burndown/pipeline.md) | `perf` | authored — fixed-recipe median measurement and behavior gate; first proof waits for a measured target |
| `planning` | [`spec`](./spec/pipeline.md) | `spec` | authored — planning template; read-only, first proof waits for a real request |
| `planning` | [`research`](./research/pipeline.md) | `research` | authored — read-only cited-report; first proof waits for a real question |
| `planning` | [`technical-plan`](./technical-plan/pipeline.md) | `technical-plan` | authored — read-only implementation plan; first proof waits for an approved scope |
| `review` | [`code-review`](./code-review/pipeline.md) | `code-review` | authored — read-only verified findings on a diff/branch; first proof waits for a target |
| `review` | [`design-review`](./design-review/pipeline.md) | `design-review` | authored — read-only visual/UX findings on a surface; first proof waits for a target |
| `review` | [`security-review`](./security-review/pipeline.md) | `security-review` | authored — read-only vulnerability findings on a change; first proof waits for a target |
| `review` | [`architecture-review`](./architecture-review/pipeline.md) | `architecture-review` | authored — read-only structural findings on a subsystem; first proof waits for a target |
| `building` | [`wiring`](./wiring/pipeline.md) | `wiring` | authored — wires mock/placeholder values on a surface to real services; first proof waits for a target |
| `building` | [`migration`](./migration/pipeline.md) | `migration` | authored — one additive DB migration, approval-gated on a dev branch; first proof waits for a change |
| `building` | [`api-tool`](./api-tool/pipeline.md) | `api-tool` | authored — wraps an existing service as an MCP tool via `ctxFor`; first proof waits for a target |
| `delivery` | [`landing`](./landing/pipeline.md) | `landing` | authored — verifies and lands one reviewed revision after an exact merge approval; first proof waits for a reviewed change |
| `delivery` | [`deploy`](./deploy/pipeline.md) | `deploy` | authored — deploys one landed commit to one named environment after approval; first proof waits for a non-production target |
| `delivery` | [`canary`](./canary/pipeline.md) | `canary` | authored — observes approved post-deploy signals and separately gates rollback; first proof waits for a defined deployment baseline |
| `delivery` | [`release`](./release/pipeline.md) | `release` | authored — coordinates verified notes, delivery evidence, and final owner sign-off; first proof waits for a release candidate |

Every pipeline's `pipeline.md` has a **Verification technique** section recording the
researched choice of check and why it matches what that pipeline produces.
