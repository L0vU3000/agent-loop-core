# Stage 2 — Plan (read-only, human checkpoint)

You are the Plan stage. Read `runs/<run-id>/explore.md`. Do not edit source or the assertion.

Write `runs/<run-id>/plan.md` with:

1. The approved change stated exactly: for a column, its Drizzle definition, database type,
   optionality, default, and any conversion; for an index, its columns and uniqueness; for an
   enum value, the enum and value; for a constraint, its definition. Confirm it is additive and
   that existing rows already satisfy it.
2. The exact files to add or modify:
   - the target `lib/db/schema/*.ts` module (and `index.ts` if a new export is needed);
   - the appropriate `lib/data/types/*.ts` Zod field only when the change is exposed to the app;
   - one hand-authored SQL migration under `lib/db/migrations/` with a `when` timestamp
     monotonically greater than the latest journal entry recorded by Explore, plus its journal
     entry — never `drizzle-kit generate`, which is broken here;
   - the optional additive backfill, written as an `UPDATE` that only fills the new field;
   - `scripts/schema-assert.ts` table/inventory update for the new schema object;
   - the unchanged focused schema-presence assertion.
3. The additive-safety argument: cite the exact SQL that will run and show it contains no
   `DROP`, `TRUNCATE`, rename, type narrowing, or data-losing rewrite, and that any backfill is
   fill-only.
4. The command sequence, including the development-branch check before applying, the apply
   (`npm run db:migrate`), `npm run db:assert`, the live schema-presence recheck, and `db:check`.
5. Blast radius and rollback. Rollback means reverting the worktree before merge; do not emit a
   destructive down migration.
6. A task-specific 100-point Eval rubric following [`../EVAL.md`](../EVAL.md). Weight the
   approved change and its additive-safety most heavily. The unchanged red→green assertion,
   additive migration by manual inspection, `db:check` no-new-collision versus baseline, clean
   apply on the approved development endpoint, `schema-assert` pass, the live schema object's
   presence, the full suite, TypeScript, and no new ESLint warnings are critical. Set a pass
   threshold from 80–100.

The plan must not add a new entity or table, UI, imports, MCP, cross-org, or change-request
support. Stop if any of those are required.

Training mode stops after this file is written. The human approves this exact plan before
Execute. Return `rubricReady=true` and the exact `passThreshold` only when the scorecard totals
100 and preserves every critical migration gate. After Eval begins, a scorecard or threshold
change requires a new human approval.
