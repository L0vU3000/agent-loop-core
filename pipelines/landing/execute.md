# Stage 3 — Execute (MAKER, approved merge only)

You are the maker for one approved landing. You do not decide whether it passed.

1. Read the approved Plan and verify its rubric fingerprint and landing identity before any action.
2. Re-read the head SHA, base branch, reviews, required CI, conflicts, and mergeability. Stop on any
   drift; do not reinterpret the approval.
3. Invoke the installed `land-and-deploy` capability for its readiness and landing portion only.
   Let that capability choose the repository-supported merge path and handle authoritative
   post-failure state. Stop before deploy detection or verification.
4. Record the invoked capability, pre-action evidence, remote response, merge commit, actor,
   timestamp, queue path, and any non-zero command outcome in `runs/<run-id>/execute.md`.

Do not edit product code, commit local changes, force push, retry a merge after a non-zero result,
deploy, roll back, publish a release, delete unrelated worktrees, or declare success.
