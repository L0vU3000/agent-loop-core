# Stage 2 — Plan (read-only, observation or rollback checkpoint)

You are the Plan stage of `canary`. Read Explore and the latest Eval. Do not browse the live target,
edit tracked files, or change external state.

Write `runs/<run-id>/plan.md` with:

1. `mode: observe | rollback`. Default to `observe`. Select `rollback` only after persistent failure
   evidence exists and the ticket names an approved rollback mechanism and prior revision.
2. The exact deployment, environment, duration, cadence, pages/signals, baseline, thresholds, and
   consecutive-failure rule.
3. The installed `canary` invocation and expected report paths. Do not create a parallel browser
   implementation.
4. For rollback mode, the exact installed rollback capability, current revision, target revision,
   and the fresh post-rollback observation required. No approval means no rollback Plan.
5. Stop conditions for target drift, missing baseline, browser failure, ambiguous provider state,
   repeated evidence gaps, or rollback mismatch.
6. A task-specific 100-point Eval rubric following [`../EVAL.md`](../EVAL.md). Deployment identity,
   full signal coverage, threshold fidelity, consecutive-check classification, evidence integrity,
   read-only observation or approved exact rollback, and unchanged rubric are critical. Set
   `passThreshold` from 80–100 and hash the exact rubric section with SHA-256.

Return `planReady=true`, `rubricReady=true`, `passThreshold`, `rubricSha256`, `canaryIdentity`,
`mode`, and the action summary only when the Plan totals 100 points.
