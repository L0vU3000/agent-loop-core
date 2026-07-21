# Stage 1 — Explore (scope gate and failing contract)

You are the read-mostly Explore stage of `entity-scaffold`. Do not implement the entity.
Your only edits are the focused test files and `runs/<run-id>/explore.md`.

## Work

1. Read the ticket and apply `pipeline.md`'s scope gate. Require an explicit approval marker
   and a complete field contract. Refuse ambiguity; do not infer fields from UI copy.
2. Run `graphify query` for the entity and closest sibling. Confirm the current pattern in:
   `lib/data/types/`, `lib/db/schema/`, `lib/services/`, `app/actions/`, `scripts/seed-neon.ts`,
   and an existing `*.db.test.ts`.
3. Confirm the database URL targets the approved development Neon branch before any later
   write. Record only the endpoint/branch identity, never credentials.
4. Record baseline results for the whole Vitest suite, TypeScript, the ESLint warning count, and
   `npm run db:check` (capture its exact output — this repo has an accepted pre-existing 0008/0011
   snapshot collision, so Eval grades the migration's `db:check` as "no *new* collision vs this
   baseline," not an absolute pass).
5. Write focused tests for the approved contract. They must fail because the entity scaffold
   is absent, not because the test harness is broken. Cover:
   - Zod create and patch validation;
   - schema and service availability;
   - live create/list/get/update/delete;
   - property filtering and cross-organization create/read/update/delete denial, including
     rejection when `propertyId` belongs to the other organization;
   - cleanup of every inserted row.
6. Write `runs/<run-id>/explore.md` with the scope verdict, approved field map, sibling pattern,
   test paths, red evidence, database branch identity, and baselines.

## Refuse fast

Set the scope verdict to `refuse` if the ticket is speculative, field-only, destructive,
cross-org, identity-related, a join table, self-referential, multi-table, or missing approval.
Explain which specialized workflow is needed. Do not create tests for a refused ticket.
