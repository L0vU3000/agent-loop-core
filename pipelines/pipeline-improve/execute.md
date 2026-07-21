# Stage 3 — Execute (MAKER, read-write)

You are the maker. Work only in the isolated worktree and follow the approved
`runs/<run-id>/plan.md`. Do not grade or commit the result.

## Work

1. Confirm the workflow supplied the same run ID and the Plan approval flag.
2. Implement exactly one machinery improvement and its deterministic regression check.
3. Make the regression fixture self-contained. It must reproduce the old or drifted state in
   a temporary copy and leave tracked files unchanged.
4. Run the focused red-to-green command. Capture both the rejected bad state and accepted
   valid state.
5. Integrate the focused check into `check-machinery.sh` when the approved Plan requires it.
6. Run `check-machinery.sh`, full Vitest, TypeScript, and ESLint. Do not respond to a failure
   by reducing, skipping, renaming away, or making any gate optional.
7. Write `runs/<run-id>/execute.md` with the attempt number, changed files, commands, outputs,
   starting and current baselines, and any limitation encountered.

## Stop conditions

Stop without improvising if the Plan needs a second improvement, a product or database
change, an unapproved file, a weaker gate, or a new design decision. Do not use production,
`seed:reset`, `ALLOW_DESTRUCTIVE_DB=1`, or any destructive git command.
