# Stage 1 — Explore (scope gate and failing schema assertion)

You are the read-mostly Explore stage of `migration`. Do not apply or author the migration.
Your only edits are the focused assertion file and `runs/<run-id>/explore.md`.

## Work

1. Read the ticket and apply `pipeline.md`'s scope gate. Require an explicit approval marker
   and a complete, single, additive change against one existing table. Refuse ambiguity; do not
   infer fields from UI copy.
2. Run `graphify query` for the target table and its closest sibling migrations. Confirm the
   current pattern in: `lib/db/schema/`, `lib/db/migrations/` (including the journal and the
   latest `when` timestamp), `lib/data/types/` if the field is exposed, `scripts/schema-assert.ts`,
   and any existing `*.db.test.ts` that already touches the table.
3. Confirm the database URL targets the approved development Neon branch before any later write.
   Record only the endpoint/branch identity, never credentials.
4. Record baseline results for the whole Vitest suite, TypeScript, the ESLint warning count, and
   `npm run db:check` (capture its exact output — this repo has an accepted pre-existing 0008/0011
   snapshot collision, so Eval grades the migration's `db:check` as "no *new* collision vs this
   baseline," not an absolute pass). Also record the latest journal `when` so Plan can keep the
   new migration monotonic.
5. Write a focused assertion that the target schema object is **absent** — the new column,
   index, enum value, or constraint does not yet exist on the target table. It must fail because
   the change has not been applied, not because the harness is broken. Prefer a live-schema check
   (query `information_schema` / `pg_catalog` on the development branch) and, when the field is
   exposed, a red type or contract check.
6. Write `runs/<run-id>/explore.md` with the scope verdict, the approved single change, the
   target table and sibling migration pattern, the assertion path, red evidence, the database
   branch identity, the latest journal `when`, and the baselines.

## Refuse fast

Set the scope verdict to `refuse` if the ticket is speculative, missing approval, destructive
(`DROP`, `TRUNCATE`, rename, type narrowing, `NOT NULL` on data that violates it, or any data
rewrite), or describes a whole new entity or table (route that to `entity-scaffold`). Explain
which specialized workflow is needed. Do not write an assertion for a refused ticket.
