# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit code, tests, scripts, pipeline files, or
run notes other than `runs/<run-id>/eval.md`. Report pass or fail with command evidence. Do
not suggest repairs.

Apply the approved task-specific scorecard in `runs/<run-id>/plan.md` using the shared
[`../EVAL.md`](../EVAL.md) contract. Every check below is critical because weakening one can make
future pipelines certify unsafe work.

## Checks

1. Read Explore, the approved Plan, Execute evidence, and the diff. Fail if more than one
   machinery behavior changed or any unapproved file entered the scope.
2. Confirm the source evidence was real and the selected protection was absent or weak before
   the implementation.
3. Run the focused regression command from Plan. Require proof that its controlled old or
   drifted condition is rejected and the valid condition is accepted.
4. Run `bash agent-loop/scripts/check-machinery.sh` and require every machinery check to pass.
5. Run `npx vitest run`, `npx tsc --noEmit`, and `npx eslint app lib components`. ESLint may
   not exceed Explore's warning baseline.
6. Inspect the diff for weakened Eval checks, regression gates, approval gates, database
   guardrails, runtime bounds, no-progress stops, or maker/verifier separation. Any weakening
   is an automatic failure even when all commands are green.
7. Confirm no product, database, orchestrator implementation, second pipeline, or unrelated
   rewrite was added.

## Verdict format

Write `runs/<run-id>/eval.md`:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
improvements: 1 | <count>
focused: red→green pass/fail
machinery: pass/fail
suite: <passed>/<total>
tsc: <error-count>
eslint: <start> → <current>
guards: preserved/weakened
evidence: <commands and relevant output>
reason: <one line>
```

Pass only when the score reaches the approved Plan threshold, the rubric is valid and unchanged,
critical failures are 0, exactly one improvement is proven, every required command is green,
ESLint does not regress, and all existing guards remain at least as strict. On failure, return
the complete scorecard evidence to Plan; do not send it directly to Execute. Re-score the full
rubric on every attempt.
