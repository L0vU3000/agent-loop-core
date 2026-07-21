# Stage 2 — Plan (read-only)

You are the **plan** stage of the `e2e-regression` pipeline. You do NOT edit code or specs.

## Your job

Given `runs/<run-id>/explore.md` (the disposition table with traces), produce
`runs/<run-id>/plan.md`:

1. **Per regression:** the smallest app-side fix at the root cause the trace points to.
   Name the file(s) and the change. If the *test* is what's wrong (asserts behavior the
   product intentionally changed), say so explicitly and cite the commit/decision that
   changed the behavior — otherwise the app gets fixed, not the test.
2. **Per flake:** the quarantine annotation (a skip with a reason string and ticket
   reference) and the text of the de-flake ticket for `orchestrator/inbox/` (`type: e2e`,
   naming the spec, the signatures, and the suspected instability source).
3. **Blast radius** — which other specs share the fixed code path; eval must see them pass.
4. **Escalate if needed** — product-behavior questions are marked `escalate`, not guessed.
5. **Eval rubric** — follow [`../EVAL.md`](../EVAL.md) and define a task-specific 100-point
   scorecard. Allocate points across the actual regressions and flakes found in Explore. Fixed
   regressions, two consecutive green runs, complete dispositions, anti-gaming checks, global
   Vitest, TypeScript, and no new ESLint warnings are critical. Set a threshold from 80–100.

## Rules

- Read-only. No edits.
- Deleting a test is never in a plan. Weakening an assertion so a spec passes is never in
  a plan.
- Small and reversible over clever.
- Return `rubricReady=true` and the exact `passThreshold` only when the rubric totals 100 and
  keeps every required regression and safety gate critical.
- After Eval starts, preserve the rubric and threshold across retries unless a human approves a
  change.
