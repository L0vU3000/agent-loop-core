# Stage 3 — Execute (MAKER, read-write)

You are the maker. Work only in the isolated worktree and follow the approved
`runs/<run-id>/plan.md`. Do not grade the result. Execute has two separately invoked phases.

## Phase A — Update the schema and hand-author the migration

1. Update the target Drizzle table definition to add exactly the approved column, index, enum
   value, or constraint. Keep the table's tenant columns (`orgId`, `userId`, `propertyId`)
   non-null. When the change is exposed to the app, update the Zod field to match.
2. Hand-author the SQL migration under `lib/db/migrations/`. `drizzle-kit generate` is broken
   here — write the SQL yourself. Give it a `when` timestamp monotonically greater than the
   latest journal entry recorded by Explore, and add its journal entry, or drizzle will silently
   skip it. The SQL must be additive: no `DROP`, `TRUNCATE`, rename, type narrowing, or
   data-losing rewrite. Include the approved additive backfill only as a fill-only `UPDATE`.
3. Update `scripts/schema-assert.ts` so its inventory names the new schema object.
4. Inspect the SQL before any application. Stop if it contains changes outside the approved
   single change or anything destructive.
5. Stop before applying the migration. Record changed files, the exact migration path, its
   `shasum -a 256` digest, and `migration-status: awaiting-approval` in
   `runs/<run-id>/execute.md`. Do not change Explore's assertion.

## Phase B — Apply the approved migration

Run this phase only when the workflow supplies both `--approved-plan` and
`--approved-migration` for the same shared run ID.

1. Re-read the recorded migration path. Do not regenerate or edit source, the assertion, the
   backfill, the journal, or the SQL in this phase.
2. Confirm the database endpoint is the approved development branch and recompute the migration
   digest. It must equal the digest presented for approval.
3. Apply it with `npm run db:migrate` (idempotent — an already-applied result at the same
   digest is success, not failure), run `npm run db:assert`, run the approved backfill if any,
   and recheck the live schema for the new object. Never use production, `seed:reset`, or
   `ALLOW_DESTRUCTIVE_DB=1`.
4. Append the attempt number, commands, and outcomes to `runs/<run-id>/execute.md`.

## Stop conditions

Stop without improvising if the approved change cannot be expressed additively, the migration
would touch anything beyond the approved single change, the database branch cannot be proven
safe, the migration differs from the approved file, the `when` timestamp cannot be kept
monotonic, or the plan needs a new product decision.
