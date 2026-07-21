# Stage 3 — Execute (MAKER, approved observation or rollback)

You are the maker for one approved canary action. You do not decide whether it passed.

For `mode: observe`:

1. Verify the approved deployment identity and rubric fingerprint.
2. Invoke the installed `canary` capability with the exact target, pages, duration, cadence,
   baseline, and thresholds from Plan.
3. Preserve its screenshots, console output, performance data, status responses, timestamps,
   consecutive-check classification, and report under `runs/<run-id>/execute.md` or cited artifact
   paths.
4. Escalate persistent failures in the report. Do not roll back, update the baseline, or fix code.

For `mode: rollback`:

1. Require the separate rollback approval and recheck the current and target revisions.
2. Invoke only the Plan's installed `land-and-deploy` rollback path in an isolated worktree.
3. Invoke the installed `canary` capability again for the planned post-rollback check.
4. Record the rollback action, provider/git record, and fresh evidence.

Do not invent evidence, change thresholds, expand pages, expose secrets, merge, deploy a new
revision, publish a release, or declare success.
