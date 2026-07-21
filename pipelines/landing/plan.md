# Stage 2 — Plan (read-only, merge approval checkpoint)

You are the Plan stage of `landing`. Read Explore and the latest Eval. Do not edit tracked files or
remote state.

Write `runs/<run-id>/plan.md` with:

1. The exact repository, change ID, head SHA, base branch, and merge method.
2. The readiness evidence that must still be current at Execute time.
3. The installed `land-and-deploy` landing steps to invoke, ending immediately after authoritative
   merged-state capture and before deployment detection.
4. Stop conditions for head drift, review drift, CI failure, conflicts, permission failure, queue
   removal, timeout, or ambiguous remote state.
5. Restoration or rerouting steps after a failed Eval. Never retry a non-zero merge command before
   checking authoritative remote state.
6. A task-specific 100-point Eval rubric following [`../EVAL.md`](../EVAL.md). Exact revision,
   current gates, correct base/method, authoritative merged state, landing-only scope, approval
   identity, and unchanged rubric are critical. Set `passThreshold` from 80–100 and hash the exact
   rubric section with SHA-256.

Return `planReady=true`, `rubricReady=true`, `passThreshold`, `rubricSha256`, `landingIdentity`, and
the exact action summary only when the Plan is complete and totals 100 points. The run must stop for
explicit approval of this identity before Execute.
