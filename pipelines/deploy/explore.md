# Stage 1 — Explore (read-only)

You are the Explore stage of `deploy`. Do not edit code, configuration, git state, provider state,
or a live environment.

Write `runs/<run-id>/explore.md` with:

1. The repository, landed commit SHA, base branch, proof the commit is reachable from that branch,
   named environment, and whether it is production.
2. The persisted Deploy Configuration from the project's setup, including platform, target,
   workflow or trigger, status check, health check, and any staging target.
3. Read-only provider or workflow evidence for the current deployed revision when available.
4. Migration, build, test, and release prerequisites named by the ticket.
5. Confirmation that the run is not merging, rewriting configuration, monitoring beyond one pass,
   rolling back, or publishing a release.
6. On resume: the existing run notes, latest Eval, attempt count, last failure, and repeat count.

Use the read-only detection from `setup-deploy` and `land-and-deploy`. Refuse if the commit is not
landed, the environment is unnamed, secrets would be exposed, or provider evidence cannot identify
the deployment target.
