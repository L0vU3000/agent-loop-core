# Stage 1 — Explore (read-only)

You are the Explore stage of `performance-burndown`. Do not edit product code, configuration, tests, or
measurement scripts.

Write `runs/<run-id>/explore.md` with:

1. The exact contract: metric, `lower` or `higher` direction, target, unit, named route/asset/query, and
   owner-stated reason.
2. One locked measurement recipe: tool and version, exact command or browser steps, build mode, server
   command and port, viewport/device or query fixture, warm/cold cache state, concurrency, timeout, and
   sample count. Require at least 3 samples.
3. Raw baseline samples, their median, and the calculation. Record failed or discarded samples with the
   predefined rule that excluded them; do not quietly remove outliers after seeing the numbers.
4. A minimum detectable improvement when the tool's normal variance needs one. Define it before Execute.
5. A behavior baseline and exact repeatable behavior command or browser flow. Capture the route response,
   rendered content, and interactions that must remain unchanged.
6. Repository baselines: `npx vitest run`, `npx tsc --noEmit`, and
   `npx eslint app lib components` with raw exit codes and warning count.
7. The current git commit, isolated-worktree confirmation, and for query work, proof that the endpoint is
   an approved Neon development branch and the query is read-only.
8. A short list of grounded levers from profiler, trace, bundle, query-plan, or source evidence. Do not
   invent a bottleneck from the metric alone.

Refuse the run when any contract field is missing, the recipe cannot be reproduced, the baseline already
meets the target, or the requested measurement needs production access. A baseline already at target is
reported as `alreadyMet=true`; no code-writing loop is needed.

On resume, read existing run notes and latest Eval. Return the last independently accepted median as
`bestValue`, the attempt count, consecutive no-progress count, last failure, and tried levers. Never adopt
a rejected attempt's measurement as the best.
