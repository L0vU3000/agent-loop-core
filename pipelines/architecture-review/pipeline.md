---
name: architecture-review
category: review
type: architecture-review
---

# Pipeline: architecture-review

> Reviews the structure of an existing subsystem, module, or the whole repository and produces
> evidence-backed findings: layering violations, tight coupling, dependency cycles, drift from the
> codebase's architecture rules, and dead or parallel code. It inspects the shape of the system; it
> does not refactor it. Every surviving finding is one the verifier could substantiate.

## Goal

Take a review ticket (an inbox item with `type: architecture-review` that names a target subsystem,
module, or the whole repo) and produce one findings report for that structure: each finding carries
a severity, a precise location (`file:line` or a module), the cited evidence that proves it — the
exact rule from `CLAUDE.md` or the dependency edge it violates — and one sentence on why it matters.
For every confirmed high-severity finding, the run may also draft a downstream building ticket so
the owner can dispatch a refactor — written `approved: false` so nothing is changed until the owner
decides.

The deliverable is a document plus optional drafted tickets — never a product change. No source
file, schema, migration, or database row is touched by this pipeline. Findings are advisory: the
owner decides what to fix.

## Scope gate

The ticket must name a real structure to review. Explore accepts only when the request points at an
existing subsystem, module, or the whole repo whose files resolve against the codebase. It refuses
and routes elsewhere when the request is:

- a request to **build or refactor** code, not review its structure — route to a building pipeline
  (`feature`, `bug-fix`, `wiring`, `migration`);
- a **line-level correctness** review of a specific diff or PR — route to `code-review`;
- a **security** audit for vulnerabilities — route to `security-review`;
- a **design/visual** critique of a surface — route to `design-review`;
- a target that names no resolvable subsystem or module — return it asking for a real region to
  review.

## Exit condition

A run passes only when every check is true:

1. **Findings are verified.** The verifier independently re-verified every reported structural
   finding against the current codebase; none survive on the maker's assertion alone.
2. **No false positives.** Any finding the verifier could not substantiate — a dependency edge that
   does not exist, a rule that does not apply to the cited code — was dropped, not shipped. A
   hallucinated or unsubstantiated finding is a critical failure.
3. **Evidence is cited.** Every surviving finding names a real `file:line` or module and cites the
   exact `CLAUDE.md` rule or the dependency edge (from `graphify path`/`query`) that proves the
   violation. A finding without resolvable evidence fails.
4. **Severity is justified.** Each finding's severity follows the stated rubric — a dependency
   cycle or a component querying the database directly is high; a mild coupling smell is low — and
   the report does not inflate taste into a structural defect.
5. **Declared scope was covered.** The review states which files/modules of the subsystem it
   examined, and that stated scope matches the region actually under review. A review that silently
   skips half the subsystem fails.
6. **Findings are read-only and advisory.** The report proposes; it does not edit product code. Any
   drafted refactor ticket carries `approved: false` and names its downstream `category`/`type`.

The score reaches the Plan threshold with zero critical failures. The findings then go to the
owner, who decides which to route to a building pipeline.

## Verification technique

This pipeline uses **adversarial re-verification of every reported finding**, because the failure
mode of an automated structure reviewer is not missing a smell — it is confidently reporting a
layering violation or dependency cycle that is not real. A findings list nobody trusts is worse than
none: it burns owner attention and trains the loop to reward volume. So the anti-false-positive gate
is the whole point, and it is the exit condition.

A different-model, read-only verifier takes the maker's findings and, for each one, tries to
**break it**: it independently substantiates the structural claim by tracing the cited dependency
edge with `graphify path`/`query` and re-reading the cited `file:line` to confirm the code really
violates the named `CLAUDE.md` rule. Any finding it cannot stand up is **dropped** — it does not
reach the owner. What the verifier grades objectively:

- **Findings verified** — each survivor's dependency edge or rule violation was independently
  re-confirmed.
- **No false positives (anti-hallucination)** — unsubstantiated or misread findings were removed.
- **Evidence cited** — every survivor resolves to a real location with the named rule or edge.
- **Severity justified** — the severity matches the rubric's definition, not the maker's emphasis.
- **Scope covered** — the declared review scope matches the subsystem actually under review.

The engine is `graphify` (`query`/`path`/`explain` and `GRAPH_REPORT.md`), which maps the codebase's
structure directly, plus targeted reading for the rule text. The maker writes findings; the verifier
confirms or drops each one and never adds its own or edits the code. The owner's judgment stays the
final gate — which real structural findings are worth a refactor, and in what order, is a product
call no pipeline should make.

This is distinct from `code-review` (line-level correctness of a diff), `security-review`
(vulnerabilities), and `design-review` (visual/UX). Architecture-review's subject is the system's
shape: which module depends on which, which layer a call crosses, and where the code has drifted
from the standing rules.

## Stages

`explore → plan → execute → eval`. Each stage runs in a fresh context. Execute is the maker; Eval
is a different-model, read-only verifier.

- **Explore:** classify the request against the scope gate, confirm the target subsystem resolves,
  and map the structure — the in-scope files and modules, the dependency edges between them (via
  `graphify`), the standing `CLAUDE.md` layering rules the region must respect, and any dead or
  parallel code (e.g. the archived Convex layer). Record the review scope so Eval can check coverage.
- **Plan:** decide the review's scope boundaries and the severity definitions for this structure,
  name the downstream building type a confirmed high-severity finding would resolve to, and author
  the task-specific 100-point Eval rubric. Findings-verified, no-false-positives, evidence-cited,
  severity-justified, and scope-covered are critical criteria.
- **Execute (maker):** run the structural review over the declared scope and write the findings
  report into `runs/<run-id>/`, plus any drafted `approved: false` refactor tickets for confirmed
  high-severity findings. Do not edit product source, schema, or the live orchestrator inbox.
- **Eval (verifier):** independently re-verify every reported finding — trace its dependency edge or
  re-confirm its rule violation — drop any it cannot stand up, check severity and scope coverage,
  and score with cited evidence. On failure, return the scorecard to Plan.

## Guardrails

- **Read-only on the product.** This pipeline's only writes are the findings report and any
  proposed refactor tickets under `runs/<run-id>/`. It never edits source, schema, migrations, seed
  data, or the live orchestrator inbox, and needs no worktree or database branch. That makes it one
  of the safest pipelines; its risk is a false-positive finding, which the verifier and the human
  gate catch.
- **Human checkpoint.** The review category's default gate applies: the owner reviews the findings
  and decides which to act on. A drafted refactor ticket is promoted from `runs/<run-id>/` to
  `agent-loop/orchestrator/inbox/` with `approved: true` only after the owner approves it. No
  building pipeline consumes an unapproved refactor ticket.
- **Findings are advisory.** The pipeline reports; it does not fix. A refactor routes to a building
  ticket the owner approves — structural and product judgment stays with the owner.
- **Bounds:** maximum 3 review attempts and a small agent-call cap per invocation; stop after the
  same verifier failure repeats twice.
- **Memory:** append failures and reusable lessons to `agent-loop/memory/errors.md`.

## Exit routing

A confirmed high-severity finding the owner accepts becomes exactly one building inbox ticket
(usually `wiring` or `feature` for a structural repair, sometimes `bug` when the violation causes a
concrete fault). The pipeline does not fix it; it hands a precise, grounded ticket to the
orchestrator, which dispatches the matching building pipeline under that pipeline's own gates.
Low-severity coupling smells may be batched or dropped at the owner's discretion.

## Status and trigger

Authored, not yet proven. Invoke `workflow.js` with a `type: architecture-review` ticket path that
names the target subsystem, module, or the whole repo. Its proof waits for a real structure to
review; it must not be exercised on a fabricated or unresolvable target.
