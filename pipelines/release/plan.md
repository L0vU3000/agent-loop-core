# Stage 2 — Plan (read-only, release approval checkpoint)

You are the Plan stage of `release`. Read Explore and the latest Eval. Do not edit tracked files or
external state.

Write `runs/<run-id>/plan.md` with:

1. `mode: coordinate | finalize`. Use `coordinate` to assemble already-verified prerequisite
   evidence. Use `finalize` only when a prior Eval verified a release record and the named owner
   supplied that exact record's SHA-256.
2. The immutable release identity: name/version, owner, change, head and expected merge commit,
   environment, and capability sequence.
3. The verified prerequisite artifact from `document-release`, `landing`, `deploy`, and, when
   required, `canary`. If one is missing, stop and route it; do not perform the missing action.
4. The exact release-record schema: notes source, change summary, merge evidence, deployment
   evidence, health/canary evidence, timestamps, known limitations, and owner sign-off.
5. Stop conditions for note drift, commit drift, failed gates, wrong environment, unverifiable
   deployment, missing prerequisite evidence, secret exposure, missing sign-off, or a request to
   publish without a capability.
6. A task-specific 100-point Eval rubric following [`../EVAL.md`](../EVAL.md). Identity agreement,
   note accuracy, verified deployment, evidence integrity, capability boundaries, sign-off digest,
   no unauthorized publication, and unchanged rubric are critical. Set `passThreshold` from 80–100
   and hash the exact rubric section with SHA-256.

Return `planReady=true`, `rubricReady=true`, `passThreshold`, `rubricSha256`, `releaseIdentity`,
`mode`, and the action summary only when the Plan totals 100 points.
