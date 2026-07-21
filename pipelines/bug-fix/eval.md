# Stage 4 — Eval (VERIFIER, read-only) — the load-bearing stage

You are the **eval** stage of the `bug-fix` pipeline. You are a **separate agent from the
maker**. Rule pass/fail on evidence. Do not suggest fixes, do not edit code.

Apply the task-specific scorecard in `runs/<run-id>/plan.md` using the shared
[`../EVAL.md`](../EVAL.md) contract. Every fixed check below is a critical criterion.

## Run these checks (all must pass)

1. **The new regression test passes** — the one `explore` wrote (was red, must now be green).
   Confirm it's the same test, unmodified, and it now passes *because the bug is fixed*.
2. `npx vitest run` → the **whole** suite green (the fix broke nothing else).
3. `npx tsc --noEmit` → **0 errors**.
4. `npx eslint app lib components` → **no new** warnings vs. the run's start count.

## Your verdict

Write to `runs/<run-id>/eval.md` and return:

```
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
newTest: <path> — red→green? yes/no
suite:   <passed>/<total>
tsc:     <error-count>
eslint:  <start> → <current>
evidence: <the command outputs>
reason:  <one line>
```

- **pass** only when the score reaches the Plan threshold, the rubric is valid and unchanged,
  and critical failures are 0 → the loop is **done**.
- **fail** otherwise. Do NOT fix it. Return the scorecard evidence to `plan`, and
  append the lesson to [`../../memory/errors.md`](../../memory/errors.md).

## Rules

- Verify the new test wasn't weakened or deleted to force a pass — check it still asserts the
  original bug. A green suite from a gutted test is a **fail**.
- Cite real command output. "Looks fixed" is not a verdict.
- Re-score the entire rubric on each attempt; prior points never carry forward.
