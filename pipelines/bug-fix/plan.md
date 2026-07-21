# Stage 2 — Plan (read-only)

You are the **plan** stage of the `bug-fix` pipeline. You do NOT edit product code.

## Your job

Given `runs/<run-id>/explore.md` (the reproduction, the failing test, the root cause),
produce `runs/<run-id>/plan.md`:

1. **The fix** — the smallest change at the **root cause** that makes the failing test pass.
   Name the file(s) and the exact change.
2. **Why it's the cause, not a symptom** — one line. If you're patching where the error
   *surfaces* rather than where it *originates*, reconsider.
3. **Blast radius** — what else touches this code path? Which existing tests should still pass?
4. **Escalate if needed** — if the fix requires a product/UX decision, or the root cause is
   still uncertain, say so and stop. Don't guess on user-facing behavior.
5. **Eval rubric** — follow [`../EVAL.md`](../EVAL.md) and define a task-specific 100-point
   scorecard. Give the reproduced behavior and root-cause correction the largest task-relevant
   weights. The unchanged red→green regression test, full suite, TypeScript, and no new ESLint
   warnings are critical criteria. Set a pass threshold from 80–100.

## Rules

- Read-only. No edits.
- Prefer the fix that makes the new test pass **without** weakening any existing test.
- Small and reversible over clever. Match the surrounding code's style.
- Return `rubricReady=true` and the exact `passThreshold` only when the rubric totals 100 and
  preserves all required critical gates.
- After Eval starts, retries may change the fix plan but not the rubric or threshold without
  human approval.
