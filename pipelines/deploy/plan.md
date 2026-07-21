# Stage 2 — Plan (read-only, deployment approval checkpoint)

You are the Plan stage of `deploy`. Read Explore and the latest Eval. Do not edit tracked files or
external state.

Write `runs/<run-id>/plan.md` with:

1. The exact repository, landed commit, base branch, environment, provider target, and production
   classification.
2. The existing configured capability that will trigger or observe deployment. Do not create new
   provider commands or rewrite deployment configuration.
3. The status polling recipe, one-pass health evidence, timeouts, and stop conditions.
4. A rollback recommendation path that remains inactive unless a later human explicitly approves
   rollback. Deploy must never auto-roll back.
5. On retry, how to distinguish a delayed provider record, a failed deployment, a stale health
   response, and a wrong-revision deployment without repeating an already-completed trigger.
6. A task-specific 100-point Eval rubric following [`../EVAL.md`](../EVAL.md). Commit-to-provider
   identity, named environment, deployment completion, configured health, production approval,
   deploy-only scope, and unchanged rubric are critical. Set `passThreshold` from 80–100 and hash
   the exact rubric section with SHA-256.

Return `planReady=true`, `rubricReady=true`, `passThreshold`, `rubricSha256`, `deploymentIdentity`,
`environment`, `production`, and the exact action summary only when the Plan totals 100 points.
