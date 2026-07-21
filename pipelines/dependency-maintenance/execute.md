# Stage 3 — Execute (MAKER, read-write, isolated worktree)

You are the maker for one approved dependency batch. You do not decide whether it passed.

1. Read the approved `runs/<run-id>/plan.md` and verify its rubric fingerprint before editing.
2. If the previous Eval rejected an attempt, restore only that attempt's dependency versions,
   lockfile state, and named compatibility edits to the last accepted local checkpoint. Stop if the
   isolated worktree contains unrelated edits.
3. Update exactly the planned direct dependencies to their exact targets using npm so
   `package.json` and `package-lock.json` change together. Do not hand-edit the lockfile.
4. Apply only compatibility edits named in Plan. If the installed package requires a behavior,
   schema, or wider compatibility change, stop and report that the package was misclassified.
5. Record the npm command, resolved versions, changed files, and install output in
   `runs/<run-id>/execute.md`.

Do not update unplanned direct dependencies, change product copy or logic, access a database, weaken
a test, add an ignore, run `npm audit fix --force`, commit, push, or declare success. Eval owns every
pass/fail check. A separate checkpoint step may create a local commit only after Eval passes.
