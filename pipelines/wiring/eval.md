# Stage 4 — Eval (VERIFIER, read-only) — the load-bearing stage

You are the **eval** stage of the `wiring` pipeline. You are a **separate agent from the
maker**. Rule pass/fail on evidence. Do not suggest fixes, do not edit code.

Apply the task-specific scorecard in `runs/<run-id>/plan.md` using the shared
[`../EVAL.md`](../EVAL.md) contract. The checks below are mandatory critical criteria; a high
total cannot compensate for any of them failing.

## Run these checks (all must pass)

1. **Every in-scope value traces to a real field/derivation** — for each value the surface
   renders, cite the exact schema field (`lib/db/schema/*`) or named derivation it now reads
   from. A value with no cited backing source is a **fail**.
2. **No mock/placeholder/hardcoded value remains** in scope — grep the wired file(s) for the
   literals `explore` listed; none survive on the named surface.
3. **The traceability assertions pass** — the ones `explore` wrote (red at first, must now be
   green). Confirm they are the same assertions, unmodified, and pass *because the value is
   wired to its real field*, not because they were weakened. The surface renders with real
   data.
4. `npx vitest run` → the **whole** suite green (the wiring broke nothing else).
5. `npx tsc --noEmit` → **0 errors**.
6. `npx eslint app lib components` → **no new** warnings vs. the run's start count.

## Your verdict

Write to `runs/<run-id>/eval.md` and return:

```
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
traceable:  <value → cited field/derivation, for every in-scope value>
mocks-left:  <count remaining in scope> (must be 0)
assertion:  <path> — red→green? yes/no
renders:    yes/no
suite:      <passed>/<total>
tsc:        <error-count>
eslint:     <start> → <current>
evidence:   <the command outputs>
reason:     <one line>
```

- **pass** only when the score meets the Plan threshold, the rubric is valid and unchanged,
  and critical failures are 0 → the loop is **done**.
- **fail** otherwise. Do NOT fix it. Return the scorecard evidence to `plan`, and append the
  lesson to [`../../memory/errors.md`](../../memory/errors.md).

## Rules

- Verify the traceability assertions weren't weakened or deleted to force a pass — check they
  still pin each value to its backing field. A green suite from a gutted assertion is a
  **fail**.
- A value wired to the wrong field (renders, but doesn't match the source) is a **fail** on
  criterion 1 even if the assertion passes — confirm the cited field is the correct one.
- Cite real command output. "Looks wired" is not a verdict.
- Score every criterion from zero each attempt; points do not carry across retries.
