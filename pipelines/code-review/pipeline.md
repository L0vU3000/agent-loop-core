---
name: code-review
category: review
type: code-review
---

# Pipeline: code-review

> Reviews an existing change — a branch, a diff, or a PR — and produces evidence-backed
> findings: correctness bugs plus reuse, simplification, and efficiency cleanups. It inspects
> the change; it does not fix it. Every surviving finding is one the verifier could reproduce.

## Goal

Take a review ticket (an inbox item with `type: code-review` that names a target branch, diff,
or PR) and produce one findings report for that change: each finding carries a severity, a
precise location (`file:line`), the cited evidence that proves it, and one sentence on why it
matters. For every confirmed high-severity finding, the run may also draft a downstream building
ticket so the owner can dispatch a fix — written `approved: false` so nothing is fixed until the
owner decides.

The deliverable is a document plus optional drafted tickets — never a product change. No source
file, schema, migration, or database row is touched by this pipeline. Findings are advisory: the
owner decides what to fix.

## Scope gate

The ticket must name a real change to review. Explore accepts only when the request points at an
existing branch/diff/PR whose contents resolve against the repository. It refuses and routes
elsewhere when the request is:

- a request to **write or fix** code, not review it — route to a building pipeline (`feature`,
  `bug-fix`, `entity`, `wiring`);
- a **security** audit for vulnerabilities — route to `security-review`;
- a **structure/boundaries** audit of the system's shape — route to `architecture-review`;
- a **design/visual** critique of a surface — route to `design-review`;
- an empty or already-merged-and-verified target with no diff to inspect — return it asking for a
  real change set.

## Exit condition

A run passes only when every check is true:

1. **Findings are verified.** The verifier independently reproduced or re-confirmed every reported
   finding against the current code; none survive on the maker's assertion alone.
2. **No false positives.** Any finding the verifier could not reproduce or whose cited code does
   not say what the finding claims was dropped, not shipped. A hallucinated or unreproducible
   finding is a critical failure.
3. **Evidence is cited.** Every surviving finding names a real `file:line` location and quotes the
   exact code (and, where relevant, the failing input or trace) that proves it. A finding without
   resolvable evidence fails.
4. **Severity is justified.** Each finding's severity follows the stated rubric — a concrete
   wrong-output/crash path is high; a cleanup is low — and the report does not inflate taste into
   correctness.
5. **Declared scope was covered.** The review states which files/hunks of the change it examined,
   and that stated scope matches the target's actual diff. A review that silently skips half the
   change fails.
6. **Findings are read-only and advisory.** The report proposes; it does not edit product code.
   Any drafted fix ticket carries `approved: false` and names its downstream `category`/`type`.

The score reaches the Plan threshold with zero critical failures. The findings then go to the
owner, who decides which to route to a building pipeline.

## Verification technique

This pipeline uses **adversarial re-verification of every reported finding**, because the failure
mode of an automated reviewer is not missing a bug — it is confidently reporting one that is not
real. A findings list nobody trusts is worse than none: it burns owner attention and trains the
loop to reward volume. So the anti-false-positive gate is the whole point.

A different-model, read-only verifier takes the maker's findings and, for each one, tries to
**break it**: it independently reproduces the defect (constructs the failing input, traces the
path) or re-reads the cited `file:line` to confirm the code actually says what the finding claims.
Any finding it cannot stand up is **dropped** — it does not reach the owner. What the verifier
grades objectively:

- **Findings verified** — each survivor was independently reproduced or its cited code re-confirmed.
- **No false positives (anti-hallucination)** — unreproducible or misquoted findings were removed.
- **Evidence cited** — every survivor resolves to a real location with quoted proof.
- **Severity justified** — the severity matches the rubric's definition, not the maker's emphasis.
- **Scope covered** — the declared review scope matches the target's actual diff.

The maker writes findings; the verifier confirms or drops each one and never adds its own or
edits the code. The owner's judgment stays the final gate — which real findings are worth fixing,
and in what order, is a product call no pipeline should make.

Reference for the review's content shape: the installed `/code-review` skill (correctness bugs +
reuse/simplification/efficiency cleanups) and `/review` are the reviewing engines the maker
follows; this pipeline adds the grounding, scoring, and maker≠verifier discipline around them.
This is distinct from `security-review` (vulnerabilities) and `architecture-review` (structure).

## Stages

`explore → plan → execute → eval`. Each stage runs in a fresh context. Execute is the maker; Eval
is a different-model, read-only verifier.

- **Explore:** classify the request against the scope gate, confirm the target change resolves
  (branch/diff/PR exists and has a real diff), and map the change — the files and hunks touched,
  the services/actions/components involved, and the standing `CLAUDE.md` constraints the code must
  respect. Record the review scope so Eval can check coverage.
- **Plan:** decide the review's scope boundaries and the severity definitions for this change,
  name the downstream building type a confirmed high-severity finding would resolve to, and author
  the task-specific 100-point Eval rubric. Findings-verified, no-false-positives, evidence-cited,
  severity-justified, and scope-covered are critical criteria.
- **Execute (maker):** run the review over the declared scope and write the findings report into
  `runs/<run-id>/`, plus any drafted `approved: false` fix tickets for confirmed high-severity
  findings. Do not edit product source, schema, or the live orchestrator inbox.
- **Eval (verifier):** independently re-verify every reported finding — reproduce it or re-confirm
  its cited code — drop any it cannot stand up, check severity and scope coverage, and score with
  cited evidence. On failure, return the scorecard to Plan.

## Guardrails

- **Read-only on the product.** This pipeline's only writes are the findings report and any
  proposed fix tickets under `runs/<run-id>/`. It never edits source, schema, migrations, seed
  data, or the live orchestrator inbox, and needs no worktree or database branch. That makes it
  one of the safest pipelines; its risk is a false-positive finding, which the verifier and the
  human gate catch.
- **Human checkpoint.** The review category's default gate applies: the owner reviews the findings
  and decides which to act on. A drafted fix ticket is promoted from `runs/<run-id>/` to
  `agent-loop/orchestrator/inbox/` with `approved: true` only after the owner approves it. No
  building pipeline consumes an unapproved fix ticket.
- **Findings are advisory.** The pipeline reports; it does not fix. A fix routes to a building
  ticket the owner approves — product and correctness judgment stays with the owner.
- **Bounds:** maximum 3 review attempts and a small agent-call cap per invocation; stop after the
  same verifier failure repeats twice.
- **Memory:** append failures and reusable lessons to `agent-loop/memory/errors.md`.

## Exit routing

A confirmed high-severity finding the owner accepts becomes exactly one building inbox ticket
(usually `bug`, sometimes `feature` for a reuse/cleanup slice). The pipeline does not fix it; it
hands a precise, grounded ticket to the orchestrator, which dispatches the matching building
pipeline under that pipeline's own gates. Low-severity cleanups may be batched or dropped at the
owner's discretion.

## Status and trigger

Authored, not yet proven — the first review pipeline. Invoke `workflow.js` with a
`type: code-review` ticket path that names the target branch, diff, or PR. Its proof waits for a
real change to review; it must not be exercised on an empty or fabricated target.
