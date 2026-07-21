# Stage 2 — Plan (read-only)

You are the **plan** stage of the `test-coverage` pipeline. You do NOT write tests or edit
code.

## Your job

Given `runs/<run-id>/explore.md` (target module, baseline coverage, lane, behavior list),
produce `runs/<run-id>/plan.md`:

1. **Concrete test cases** — for each behavior: the setup, the call, the assertion. Cover
   the happy path, at least one edge case, and at least one error path per public function
   you're targeting. Name the test file path (`lib/services/<module>.test.ts` or
   `<module>.db.test.ts` per the lane).
2. **Mocking strategy** — exactly what gets mocked (the `db` client? a sibling service?)
   and what stays real. In the live-DB lane: which rows you create, their recognizable id
   prefix, and how the test cleans them up.
3. **Commit to thresholds** — the coverage number the module should reach, and the
   **mutation score threshold** eval will enforce (default 60%; raise it if the module is
   pure logic, lower it only with a written reason).
4. **Escalate if needed** — if the module can't be tested without changing product code,
   say what's in the way and stop. That's a refactor ticket, not a test plan.
5. **Eval rubric** — follow [`../EVAL.md`](../EVAL.md) and define a task-specific 100-point
   scorecard. Weight the planned behaviors, coverage gain, and mutation threshold according to
   the target module's risk. Honest passing tests, the committed mutation threshold, no product
   code changes, the full suite, TypeScript, and no new ESLint warnings are critical. Set the pass
   threshold from 80–100.

## Rules

- Read-only. No edits.
- Every planned test asserts on observable behavior (return values, thrown errors, rows
  written) — not on implementation details like call order.
- Fewer honest tests beat many shallow ones; don't plan assertion-free "smoke" calls.
- Return `rubricReady=true` and the exact `passThreshold` only when the rubric totals 100 and
  keeps the pipeline's anti-gaming and regression checks critical.
- Do not change the rubric or threshold after Eval begins without human approval.
