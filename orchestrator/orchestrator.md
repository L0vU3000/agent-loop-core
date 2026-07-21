# Orchestrator — the router

> The always-checking layer over *many* pipelines. Its **only** job: read the inbox,
> pick the right pipeline for each work item, dispatch it, record the outcome, sleep.
> It does **not** do the work itself — it routes. (Anthropic's *orchestrator-worker*;
> IndyDevDan's *factory router agent*.)

This is the one piece the [skills library](../skills-library.md) doesn't give us for
free — everything below the router already exists. Build it **after** one pipeline works.

---

## The heartbeat (the loop)

```
every N minutes  (trigger: /loop or /schedule — NOT a raw while-true)
  1. read inbox/  →  any new *.md work items?
  2. for each new item:
       a. validate category + type against the pipeline registry
       b. pick a pipeline   (match item.type → pipelines/<name>/ inside that category)
       c. mark it in-progress   (move/annotate the item)
       d. dispatch  →  run that pipeline in an isolated worktree
       e. record outcome   →  memory/changelog.md (+ errors.md on failure)
       f. move the item to done/ or failed/
  3. refresh the board  →  run scripts/update-dashboard.sh
  4. sleep until next tick
```

The **dashboard** (`../dashboard.md`) is the at-a-glance view of what's running / queued /
completed. It is **generated** by [`scripts/update-dashboard.sh`](../scripts/update-dashboard.sh)
from real state (inbox files + run folders) — never hand-edited, so it can't drift. Keep it
fresh three ways: the orchestrator regenerates it each tick (step 3); or `/loop 2m bash
agent-loop/scripts/update-dashboard.sh` while a workflow runs; or run it by hand anytime.

Keep the router's own context **lean** — it reads a one-line summary per item and a
pipeline registry, nothing more. It must never accumulate the full history of every run
(that's the "dumb zone" — Horthy). Each pipeline run owns its own fresh context.

---

## Routing table (pipeline registry)

Categories define the broad work policy; `type` selects the exact peer pipeline. See
[`categories.md`](../categories.md) for the category contract. The registry grows as we add
pipelines. Today:

| Category | Item `type` | Pipeline | Verification (exit condition) |
|---|---|---|---|
| `maintenance` | `lint` | [`pipelines/eslint-burndown`](../pipelines/eslint-burndown/pipeline.md) | `eslint` warning count strictly ↓, `tsc`+`vitest` still green |
| `building` | `bug` | [`pipelines/bug-fix`](../pipelines/bug-fix/pipeline.md) | new regression test red→green, full suite + `tsc` + `eslint` clean |
| `building` | `feature` | [`pipelines/feature`](../pipelines/feature/pipeline.md) | acceptance tests red→green, full suite + `tsc` + `eslint` clean |
| `building` | `entity` | [`pipelines/entity-scaffold`](../pipelines/entity-scaffold/pipeline.md) | approved contract red→green, additive migration, tenant-safe live CRUD test, global gates clean |
| `building` | `wiring` | [`pipelines/wiring`](../pipelines/wiring/pipeline.md) | every in-scope value traces to a real schema field/derivation, no mocks remain, surface renders, gates clean |
| `building` | `migration` | [`pipelines/migration`](../pipelines/migration/pipeline.md) | one additive migration applied on a dev branch, schema-assert green, `db:check` no-new-collision, gates clean |
| `building` | `api-tool` | [`pipelines/api-tool`](../pipelines/api-tool/pipeline.md) | tool wraps an existing service via `ctxFor`, authz enforced + input validated + no error leak, gates clean |
| `testing` | `test` | [`pipelines/test-coverage`](../pipelines/test-coverage/pipeline.md) | new tests pass, module coverage strictly ↑, Stryker mutation score ≥ threshold, gates clean |
| `testing` | `qa` | [`pipelines/qa`](../pipelines/qa/pipeline.md) | all in-scope flows re-driven green in a fresh browser session, 0 console errors, gates clean |
| `testing` | `e2e` | [`pipelines/e2e-regression`](../pipelines/e2e-regression/pipeline.md) | e2e suite green ×2 consecutive, every failure fixed or quarantined+ticketed, gates clean |
| `maintenance` | `pipeline-improve` | [`pipelines/pipeline-improve`](../pipelines/pipeline-improve/pipeline.md) | one focused machinery regression red→green, machinery + full repository gates clean |
| `maintenance` | `dependency` | [`pipelines/dependency-maintenance`](../pipelines/dependency-maintenance/pipeline.md) | npm outdated+audit backlog strictly lower, approved versions landed, build + suite + types + lint green, behavior unchanged |
| `maintenance` | `perf` | [`pipelines/performance-burndown`](../pipelines/performance-burndown/pipeline.md) | fixed-recipe median reaches target, behavior unchanged, suite + types + lint green |
| `planning` | `spec` | [`pipelines/spec`](../pipelines/spec/pipeline.md) | grounded spec: every reference resolves, criteria testable, scope bounded, not a duplicate, valid `approved: false` ticket drafted |
| `planning` | `research` | [`pipelines/research`](../pipelines/research/pipeline.md) | cited report: every claim backed by a resolving source, question answered, uncertainty stated |
| `planning` | `technical-plan` | [`pipelines/technical-plan`](../pipelines/technical-plan/pipeline.md) | grounded plan: references resolve, layers complete, sequenced, bounded, constraints respected |
| `review` | `code-review` | [`pipelines/code-review`](../pipelines/code-review/pipeline.md) | verified findings: every reported issue reproduced with cited evidence, no false positives, scope covered |
| `review` | `design-review` | [`pipelines/design-review`](../pipelines/design-review/pipeline.md) | verified visual/UX findings: each re-observed on the live surface, no false positives, scope covered |
| `review` | `security-review` | [`pipelines/security-review`](../pipelines/security-review/pipeline.md) | verified vulnerabilities: each reproduced against the change with cited exploit path, no false positives |
| `review` | `architecture-review` | [`pipelines/architecture-review`](../pipelines/architecture-review/pipeline.md) | verified structural findings: each cited edge/rule violation confirmed, no false positives, scope covered |
| `delivery` | `landing` | [`pipelines/landing`](../pipelines/landing/pipeline.md) | exact reviewed revision merged into the approved base with current gates and authoritative remote evidence; no deployment action |
| `delivery` | `deploy` | [`pipelines/deploy`](../pipelines/deploy/pipeline.md) | exact landed commit matched to the named environment's provider record and configured health evidence |
| `delivery` | `canary` | [`pipelines/canary`](../pipelines/canary/pipeline.md) | approved signal window classified with differential evidence; persistent failures escalated or exact approved rollback verified |
| `delivery` | `release` | [`pipelines/release`](../pipelines/release/pipeline.md) | notes, reviewed change, merge, deployment, and health evidence agree; exact release record receives final owner sign-off |
An advanced version (later) replaces this table with a **factory-router agent** that reads
the codebase and *picks* the pipeline + model tier by price/performance/speed. Start with
the table.

---

## Work items — the inbox contract

Work lands in [`inbox/`](./inbox/) as one Markdown file per item. Minimum shape:

```markdown
---
category: maintenance # broad work policy; must match the registered pipeline
type: lint            # matches a row in the routing table
priority: normal      # low | normal | high
created: 2026-07-15
---

<one paragraph: what needs doing and what "done" looks like>
```

The orchestrator uses `category` to apply the broad routing and safety policy, then `type`
to select the exact pipeline. A category/type mismatch is invalid and must be returned for
correction rather than guessed. A future factory-router may accept an unspecified type and
select among pipelines within the supplied category; the current router requires both.

---

## Guardrails (non-negotiable)

- **Isolation:** every dispatched pipeline runs in its **own git worktree** — never on the
  live branch, never two pipelines in the same tree.
- **Data safety:** any pipeline that writes data uses a **Neon dev branch**, never prod,
  and **never `seed:reset`**.
- **Bounded:** the router honors each pipeline's max-iterations / max-time. No open-ended runs.
- **Human at the two constraints:** you review the *plan* (start) and the *result* (end).
  Slide those inward only as a pipeline earns trust.

## The dispatcher (built)

The routing + bookkeeping half of the heartbeat is now executable:
[`dispatch.mjs`](./dispatch.mjs). It is deterministic, zero-token code — the part of the loop
that should never spend a model call.

```
node agent-loop/orchestrator/dispatch.mjs            # print the dispatch plan (dry run)
node agent-loop/orchestrator/dispatch.mjs --json     # same plan, machine-readable
node agent-loop/orchestrator/dispatch.mjs --record <file> <pass|fail> [--summary "..."]
```

What it does each tick:

1. Loads the routing table from the **canonical source** — `pipeline.md` frontmatter, via the
   same `validatePipelineRegistry` the machinery self-check uses (no second table to drift). If
   the registry is broken it **refuses to route** and exits non-zero.
2. Reads `inbox/*.md` (top-level only; `done/` and `failed/` are archives).
3. Validates each item: frontmatter present, and the `type` selects a pipeline whose
   `category` matches the item's. A category/type mismatch, an unknown type, or missing
   frontmatter is returned as **invalid — for correction, never guessed**.
4. Emits the dispatch plan in priority order (`high` → `normal` → `low`): item → pipeline →
   `workflow.js`.
5. `--record` moves a finished item into `done/` or `failed/` and appends the outcome to
   `dispatch-log.md` (the bookkeeping half of steps e–f above). A claimed **`pass`** on a
   code-changing pipeline (`building` / `testing` / `maintenance`) is **re-verified here** before
   it is trusted: the doorway re-runs the fast objective gates (`check-machinery.sh` + `tsc`) and
   downgrades the record to `fail` if they don't actually hold. This is the one place every
   pipeline's verdict passes through, so the check lives here once instead of in each sandboxed
   `workflow.js`. It only ever makes a verdict stricter — a claimed `fail` is never upgraded, and
   an environment that can't run the checks is skipped, not failed. `--skip-gate` bypasses it for
   a quick manual record; read-only pipelines (`planning` / `review` / `delivery`) are recorded
   as-is. **Record against the live tree, not the run's worktree** — a record written inside the
   worktree moves the item and appends the log on a throwaway branch, so the live inbox still shows
   the item queued and the next tick re-routes it. On a `fail` (code abandoned) record from the live
   workspace; on a `pass` land the worktree's change onto the live branch first, then record from the
   live tree so the doorway re-runs its gates against the landed change.

### The one boundary: it routes, it does not execute

A pipeline is a `workflow.js` run by the built-in **Workflow runtime** (the harness), which a
plain node process cannot invoke — and the system stays on
[built-in primitives only](../memory/decisions.md) (no external daemon). So the dispatcher
emits *which* workflow to run for *which* item; the runtime runs it and reports back via
`--record`. This is precisely "the orchestrator routes; it does not do the work itself."

## The heartbeat tick (built)

[`tick.mjs`](./tick.mjs) is one scheduled pass — the loop closed as far as built-in
primitives allow. Trigger it on a cadence (never a raw `while(true)`):

```
/loop 30m node agent-loop/orchestrator/tick.mjs      # local
# or a /schedule cloud routine running the same command
```

Each tick: plans (via `dispatch.mjs`) → refreshes the board → prints an **AGENT ACTIONS**
block. The deterministic parts (plan + board) run in code; the one agent-in-the-loop step is
explicit, because a node process cannot invoke the Workflow runtime. So the scheduler wakes an
**agent**, the agent runs the tick, executes the printed `Workflow({ scriptPath })` calls (one
worktree per run), and `--record`s each outcome. Invalid items are printed for correction and
never routed; an idle inbox exits cleanly.

### Deliberately deferred: the factory-router agent

The advanced version replaces the static table with a codebase-aware agent that *picks* the
pipeline + model tier. It is **not built, on purpose** — the type→pipeline table routes every
current item correctly, so an LLM selector would be speculative machinery with nothing to
decide yet. The ADR's guidance holds: start with the table (done); earn the agent when a real
item can't be routed by type alone.
