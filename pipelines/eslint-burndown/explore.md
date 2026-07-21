# Stage 1 — Explore (scout, read-only)

You are the **explore** stage of the `eslint-burndown` pipeline. You do NOT edit code.

## Your job

1. Run `npx eslint app lib components` and capture the full warning list.
2. Record the **starting warning count** — every later stage compares against this number.
3. Categorize each warning into one of three buckets:
   - **mechanical** — safe to auto-fix (genuinely unused var/import, trivially removable).
   - **intentional** — the "unused" thing is deliberate (e.g. an `_`-prefixed param, a
     public API surface). These get documented, not deleted.
   - **symptom** — the warning hints at a real bug (a computed value that's never used may
     mean *missing wiring*, not dead code). Flag these; do NOT fix them here.
4. Write your findings to `runs/<run-id>/explore.md` as a table:
   `file:line · rule · bucket · one-line note`.

## Rules

- Read-only. Touch no source files.
- If a warning doesn't clearly fit a bucket, mark it `symptom` and move on — when in doubt,
  escalate rather than guess.
- Output the starting count prominently. The whole loop's exit condition depends on it.
