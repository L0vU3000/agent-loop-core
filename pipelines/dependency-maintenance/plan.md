# Stage 2 — Plan (read-only, human checkpoint)

You are the Plan stage of `dependency-maintenance`. Read `runs/<run-id>/explore.md` and the latest
Eval when present. Do not edit tracked files.

Write `runs/<run-id>/plan.md` with:

1. One batch: 1–5 eligible runtime packages or 3–8 eligible development packages. Prefer patch
   updates, then minor updates. Do not mix a package with unclear risk into the batch.
2. For every package: exact current and target versions, dependency section, release-note evidence,
   why the update is behavior-preserving, and any compatibility edit it requires.
3. Exact commands. Use npm's normal manifest/lockfile update path and preserve this repository's
   existing version-range style. Do not hand-edit `package-lock.json`.
4. Expected backlog movement and which outdated or audit entries the batch should resolve. Keep
   outdated and vulnerability entries separate even when they name the same package.
5. A defer list with the destination pipeline or owner decision for every excluded entry.
6. On a retry, exact restoration steps that return the rejected dependency versions and source
   edits to the last accepted checkpoint before applying the next batch.
7. A task-specific 100-point Eval rubric following [`../EVAL.md`](../EVAL.md). The following are
   critical: strict backlog reduction; exact planned versions landed with no unplanned direct bump;
   build, Vitest, and TypeScript green; no new ESLint warnings; no product behavior or copy change;
   and an unchanged valid rubric. Set `passThreshold` from 80–100 and hash the exact rubric section
   with SHA-256.

Return `planReady=true`, `rubricReady=true`, `passThreshold`, `rubricSha256`, and the exact batch
description only when the Plan is complete and the rubric totals 100. If no eligible batch remains,
return `batchPlanned=false` with whether every remaining entry is explicitly deferred.

Training mode stops after Plan. A human approves this exact batch before Execute. After Eval begins,
changing its rubric or threshold requires a new human approval.
