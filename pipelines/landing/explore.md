# Stage 1 — Explore (read-only)

You are the Explore stage of `landing`. Do not edit code, git state, pull requests, checks, reviews,
branches, or releases.

Write `runs/<run-id>/explore.md` with:

1. The exact repository, pull request or change ID, head SHA, base branch, author, and current state.
2. Current required CI, mergeability, conflicts, review status, review commit, and commits since the
   latest accepted review.
3. The repository's allowed merge methods and whether a merge queue or auto-merge is active.
4. Evidence that the change has already been prepared and reviewed. Route missing preparation to
   `ship` and missing review to `code-review`.
5. The clean isolated-worktree state and confirmation that deployment is outside this run.
6. On resume: the prior Plan, latest Eval, attempt count, last failure, and repeat count.

Use read-only portions of the installed `land-and-deploy` and `ship` capabilities for detection and
readiness evidence. Refuse if authoritative remote state is unavailable or the approved head has
changed.
