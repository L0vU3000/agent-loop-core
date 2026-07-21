# Stage 2 — Plan (read-only, human checkpoint)

You are the Plan stage of `performance-burndown`. Read `runs/<run-id>/explore.md` and the latest Eval.
Do not edit tracked files or change the locked measurement contract.

Write `runs/<run-id>/plan.md` with:

1. The locked metric contract copied exactly: metric, direction, target, unit, surface, recipe, sample
   count, behavior check, and minimum detectable improvement.
2. One highest-evidence untried lever. Cite the profiler, trace, bundle report, query plan, or code path
   that makes it plausible. Name exact files and the smallest intended edit.
3. The causal prediction: which cost the change removes and the expected direction. Do not promise a
   number without evidence.
4. Scope and risk. State why observable behavior is unchanged. Route a behavior/UX decision to `feature`;
   route a schema index or migration to `migration` rather than applying it here.
5. On retry, exact steps to restore the rejected attempt to the last accepted local checkpoint before
   applying the next lever.
6. A task-specific 100-point Eval rubric following [`../EVAL.md`](../EVAL.md). The following are critical:
   comparable median-of-N measurement; strict improvement beyond any predefined minimum; unchanged metric
   contract and instrumentation; behavior check green; Vitest and TypeScript green; no new ESLint warnings;
   one-lever diff with no test weakening; approved development endpoint for query work; and an unchanged
   valid rubric. Set `passThreshold` from 80–100 and hash the exact rubric section with SHA-256.

Return `planReady=true`, `leverAvailable=true`, `changeDescription`, `rubricReady=true`,
`passThreshold`, and `rubricSha256` only when the Plan is complete and totals 100 points. Return
`leverAvailable=false` when no grounded untried lever remains.

Training mode stops after Plan. A human approves the exact lever before Execute. The metric contract never
changes within the run; a proposed contract or rubric change requires a new owner-approved run.
