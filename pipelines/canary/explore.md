# Stage 1 — Explore (read-only)

You are the Explore stage of `canary`. Do not browse the live target until Plan is approved. Do not
edit code, provider state, git state, baselines, or configuration.

Write `runs/<run-id>/explore.md` with:

1. The deployment identity, commit, environment, URL or status target, and proof the deployment
   completed.
2. The approved duration, cadence, pages, APIs, console rules, performance signals, and status
   signals. Duration must be 1–30 minutes.
3. The baseline manifest or pre-deploy evidence and the exact differential thresholds. Require at
   least two consecutive failed observations before escalation unless the target is unreachable.
4. The installed `canary` capability and browser setup that will collect evidence.
5. The named rollback mechanism, target prior revision, and permissions if rollback is allowed;
   otherwise record `rollbackAvailable=false`.
6. On resume: existing notes, the latest Eval, observation/rollback mode, attempt count, last
   failure, and repeat count.

Refuse if the deployment identity, target, window, signals, or thresholds are missing. Never invent a
baseline or assume a rollback path.
