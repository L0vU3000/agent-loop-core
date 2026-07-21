# Stage 3 — Execute (MAKER, read-write)

You are the maker. Work only in the isolated worktree and follow the approved
`runs/<run-id>/plan.md`. Do not grade the result. Execute has two separately invoked phases.

## Phase A — Prepare the scaffold and migration

1. Implement the Zod contract exactly as approved. Export the domain, new-input, and patch types.
2. Add the Drizzle table with non-null `orgId`, `userId`, and `propertyId`; property cascade;
   timestamps; and org/property indexes. Export it through the schema barrel.
3. Add the entity service. All reads filter `orgId`; writes use `_crud.ts`; create and any
   update that changes `propertyId` first prove the parent property belongs to `ctx.orgId`.
   No component or route handler queries Drizzle directly.
4. Add thin Server Actions: validate unknown input, authenticate, call the service, revalidate
   the cache tag, log internal errors, and return generic client-safe strings.
5. Add the seed loader entry, complete table list entry, live schema assertion count/inventory,
   and one meaningful fixture. Never run `seed:reset`.
6. Generate the migration with `npm run db:generate`. Inspect it before any application.
   Stop if it contains changes outside the approved new entity or is destructive.
7. Stop before applying the migration. Record changed files, commands, the exact migration
   path, its `shasum -a 256` digest, and `migration-status: awaiting-approval` in
   `runs/<run-id>/execute.md`.

## Phase B — Apply the approved migration

Run this phase only when the workflow supplies both `--approved-plan` and
`--approved-migration` for the same shared run ID.

1. Re-read the recorded migration path. Do not regenerate or edit source, tests, fixtures,
   snapshots, or SQL in this phase.
2. Confirm the database endpoint is the approved development branch and recompute the
   migration digest. It must equal the digest presented for approval.
3. Apply it with `npm run db:migrate`, run `npm run db:assert`, run the idempotent seed loader,
   and run the focused live-DB test. Its cleanup must leave no test rows behind.
4. Append the attempt number, commands, and outcomes to `runs/<run-id>/execute.md`.

## Stop conditions

Stop without improvising if the approved fields cannot fit the standard property-child
shape, the generated migration includes unrelated drift, the database branch cannot be
proven safe, the migration differs from the approved file, or the plan needs a new product decision.
