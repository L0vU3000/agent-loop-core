---
name: migration
category: building
type: migration
---

# Pipeline: migration

> Applies one already-approved, additive schema change to an existing table through the
> repository's hand-authored migration path: an updated Drizzle table definition, a
> hand-written SQL migration under `lib/db/migrations/`, an updated `scripts/schema-assert.ts`
> inventory, and an optional additive backfill. It changes one existing table; it does not
> add a whole new entity and it does not decide which schema changes the product needs.

## Goal

Turn one approved, additive schema change — a new column, index, enum value, or constraint on
an existing table, with an optional additive backfill — into an applied, tenant-safe migration
without inventing fields, widening product scope, or touching data destructively.

## Scope gate

The ticket must explicitly mark the schema change approved and provide:

- the existing target table and the single change being made;
- for a new column: domain name, Zod type (if exposed), database column/type, optionality,
  default, and whether a backfill is required;
- for a new index: the columns and uniqueness;
- for a new enum value: the enum and the value;
- for a new constraint: the constraint kind and the columns it covers;
- the optional backfill rule, stated as an additive `UPDATE` that fills the new column and
  never deletes or rewrites existing meaning;
- the product capability that will consume the change.

Use this ticket shape so every run receives the same explicit change:

```markdown
---
category: building
type: migration
priority: normal
created: YYYY-MM-DD
approved: true
---

## Product capability
<the approved user capability that needs this schema change>

## Target table
<existing table name>

## Schema change
- Kind: column | index | enum-value | constraint
- Details: <column/type/default, or index columns, or enum+value, or constraint definition>
- Backfill: none | <additive UPDATE rule that fills the new field without rewriting data>
```

This pipeline accepts exactly one additive change to one existing table:

- a nullable or defaulted new column, a new index, a new enum value, or a new constraint that
  existing rows already satisfy;
- an optional additive backfill that only fills the new field;
- no change to the table's tenant columns (`orgId`, `userId`, `propertyId` stay non-null).

It refuses destructive changes (`DROP`, `TRUNCATE`, column or table rename, type narrowing,
`NOT NULL` on a column existing rows violate, or any data rewrite that loses meaning) and
routes them to a separately approved specialized effort. It refuses a whole new entity or table
and routes that to `entity-scaffold`. It also refuses UI work, imports, MCP tools, and
speculative changes.

## Exit condition

A run passes only when all checks are true:

1. The unchanged focused assertion written by Explore is red before the migration (the target
   column, index, enum value, or constraint is absent) and green after (it exists).
2. The updated Drizzle table definition, the hand-authored SQL migration, its journal entry,
   the `scripts/schema-assert.ts` inventory, and any exposed Zod field all implement the
   approved change and nothing else.
3. The migration is additive — confirmed by manual inspection of the SQL — with no `DROP`,
   `TRUNCATE`, rename, type narrowing, or data rewrite, and any backfill only fills the new
   field. Its `when` timestamp is monotonic against the existing journal so drizzle does not
   silently skip it.
4. The migration applies cleanly on the approved development branch, `npm run db:assert`
   passes, and the new schema object is present in the live schema.
5. `npm run db:check` shows no *new* collision versus the Explore baseline — graded the same
   relative way as ESLint, because this repo carries an accepted pre-existing `drizzle-kit`
   snapshot collision (0008/0011) that aborts `db:check` upstream of any new migration. A new
   collision the migration introduces still fails.
6. `npx vitest run`, `npx tsc --noEmit`, and `npx eslint app lib components` retain the run's
   starting health.

## Verification technique

This pipeline uses a **focused schema-presence assertion plus a live migration apply**. The
assertion proves the exact schema object was absent before and present after, for the intended
reason rather than a broken harness. The live apply on the development branch proves the
hand-authored SQL runs cleanly, that `schema-assert` still matches the live schema, and that
`db:check` gains no new migration-history collision. A migration graph that checks clean does
not prove an individual migration is non-destructive, so the verifier also reads the raw SQL
and rules on additivity by manual inspection. Because `drizzle-kit generate` is unreliable in
this repo, the SQL is hand-authored (see `vault/decisions/drizzle-only-hand-authored-migrations.md`),
and `db:check` is graded relative to the recorded baseline:

- https://orm.drizzle.team/docs/kit-overview
- https://orm.drizzle.team/docs/drizzle-kit-migrate

## Stages

`explore → plan → execute → eval`. Each stage has a fresh context. Execute is the maker;
Eval is a different-model, read-only verifier.

- **Explore:** validate the scope gate, map the target table and its closest existing
  migrations, record baseline gates, and write the failing schema-presence assertion.
- **Plan:** enumerate every file and the exact approved change, plus the 100-point rubric.
  The first real run stops here for human approval.
- **Execute:** update the schema definition and hand-author the migration in an isolated
  worktree, then stop before applying it.
- **Eval:** independently inspect the SQL and run the focused and global gates.

## Guardrails

- **Training mode:** locked on while the pipeline is unproven. The workflow first stops after
  Plan and resumes with `--resume=<run-id> --approved-plan`. It stops again after the migration
  SQL is hand-authored and resumes with `--approved-migration`. Removing these stops requires a
  later, reviewed pipeline-definition change after a successful real run is recorded.
- **Isolation:** one pipeline run per git worktree.
- **Database:** development Neon branch only. Never production, never `seed:reset`, never
  `ALLOW_DESTRUCTIVE_DB=1`.
- **Additive only:** no `DROP`, `TRUNCATE`, data rewrite, rename, or type-narrowing change; a
  backfill may only fill the new field.
- **Bounds:** maximum 4 recorded apply attempts, a 75-minute call-launch window, 7 agent calls
  per invocation, and a declared 60,000-token ceiling. The workflow stops launching calls after
  the time window, but the current API cannot cancel a call already in flight. It also does not
  expose live token metering, so the fixed agent-call cap is the enforceable local proxy; a
  future dispatcher must enforce the token ceiling at launch.
- **No progress:** stop after the same verifier failure occurs twice consecutively.
- **Human checkpoints:** approval of the schema change, approval of Plan, and approval before
  applying the hand-authored migration.
- **Memory:** append failures and reusable lessons to `agent-loop/memory/errors.md`.

## Status and trigger

Authored but not yet product-proven. Invoke `workflow.js` with an approved migration ticket
path. The first invocation returns after Plan; inspect it, then resume with the emitted run ID
and `--approved-plan`. After Execute hand-authors the SQL, inspect that exact file and resume
with the same flags plus `--approved-migration`.
