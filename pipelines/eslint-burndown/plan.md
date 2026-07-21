# Stage 2 — Plan (read-only)

You are the **plan** stage of the `eslint-burndown` pipeline. You do NOT edit code.

## Your job

Given `runs/<run-id>/explore.md`, produce `runs/<run-id>/plan.md`:

1. **This batch** — pick the next set of **mechanical** warnings to fix (start small: 5–10).
   Small batches keep each `eval` fast and make a regression easy to bisect.
2. **Per warning, the exact fix** — "delete unused import X in file Y", "prefix param `_`".
   Be specific enough that `execute` does no thinking, only editing.
3. **Defer list** — `intentional` warnings to document (not delete) and `symptom` warnings
   to hand back to a human / the bug pipeline. These do NOT get "fixed" to silence them.
4. **Predicted new count** — starting count minus this batch, so `eval` knows the target.
5. **Eval rubric** — follow [`../EVAL.md`](../EVAL.md) and define a 100-point scorecard for this
   batch. Weight the planned warning reduction by size and certainty. A strictly lower warning
   count, zero TypeScript errors, and a fully green test suite are critical. Set the pass threshold
   from 80–100.

## Rules

- Read-only. No edits.
- Never plan a fix that changes behavior. A lint warning is not worth a logic change — if
  silencing it needs real code changes, it's a `symptom`, defer it.
- Keep the batch small. You'd rather loop 6 times cleanly than fix 60 and break one test.
- Return `rubricReady=true` and the exact `passThreshold` only when the rubric totals 100 and
  preserves all required critical gates.
- Once Eval begins, keep the rubric and threshold locked for that batch.
