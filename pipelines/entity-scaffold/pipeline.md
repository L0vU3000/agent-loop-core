---
name: entity-scaffold
category: building
type: entity
---

# Pipeline: entity-scaffold

> Adds one already-approved backend entity through the repository's complete data path:
> input-validation contract (see STACK.md) → the schema definition → generated migration → org-scoped service → validated
> Server Actions → meaningful demo fixture → integration tests. It does not decide which
> entities the product needs.

## Goal

Turn one approved, ordinary property-child entity contract into a complete, tenant-safe
backend scaffold without inventing fields or widening product scope.

## Scope gate

The ticket must explicitly mark the entity contract approved and provide:

- singular and plural names, table name, human-readable ID prefix, and cache tag;
- every field's domain name, validation-layer type, database column/type, optionality, and default;
- the `propertyId` relationship and delete behavior;
- one meaningful demo fixture;
- the product capability that will consume the entity.

Use this ticket shape so every run receives the same explicit contract:

```markdown
---
category: building
type: entity
priority: normal
created: YYYY-MM-DD
approved: true
---

## Product capability
<the approved user capability that needs this entity>

## Entity contract
- Singular name:
- Plural name:
- Table name:
- ID prefix:
- Cache tag:

| Domain field | Validation type | DB column | DB type | Required | Default |
|---|---|---|---|---|---|

Relationship: `propertyId → properties.id`, delete cascade.

## Demo fixture
<one complete, meaningful record>
```

This pipeline accepts exactly one new entity with the standard shape:

- non-null `orgId`, `userId`, and `propertyId`;
- `propertyId` references `properties.id` with `onDelete: "cascade"`;
- ordinary list/get/create/update/delete behavior through the services layer;
- create/update/delete Server Actions that validate unknown input with the validation layer.

It refuses field-only changes, identity or cross-org tables, join tables, self-references,
multi-table aggregates, backfills, destructive migrations, UI work, imports, MCP tools,
and speculative entities. Route those to a feature, migration, or separately approved
specialized pipeline.

## Exit condition

A run passes only when all checks are true:

1. The unchanged contract test written by Explore is red before the scaffold and green after.
2. The validation-layer type, schema-definition table, schema barrel export, generated migration, service, Server
   Actions, seed loader entry, and meaningful fixture all implement the approved contract.
3. The focused live-DB test proves create → list/get → update → delete, domain/DB type
   conversion, property filtering, and organization isolation. It must also prove that create
   and update reject a `propertyId` owned by another organization. It cleans up every row it creates.
4. The generated migration is additive (confirmed by manual inspection) and `npm run db:check`
   shows no new collision versus the Explore baseline — graded the same relative way as ESLint,
   because this repo carries an accepted pre-existing migration-tool snapshot collision (0008/0011)
   that aborts `db:check` upstream of any new migration. A new collision the migration introduces
   still fails. Applying it is allowed only after the dev-database identity has been
   confirmed; production is forbidden.
5. `npx vitest run`, `npx tsc --noEmit`, and `npx eslint app lib components` retain the
   run's starting health.

## Verification technique

This pipeline uses **contract tests plus live database integration tests**. The contract test
proves all required layers exist and agree on names and fields. The live test proves the SQL
and organization predicates actually work; a mocked unit test cannot establish tenant
isolation. The data layer's code-first migration flow compares the TypeScript schema with the latest
snapshot to generate SQL, while the migration tool's check command detects migration-history conflicts:

- See STACK.md for the data layer's migration-generation docs.
- See STACK.md for the data layer's migration-check docs.

The verifier also inspects the generated SQL because a clean migration graph does not prove
that an individual migration is non-destructive.

## Stages

`explore → plan → execute → eval`. Each stage has a fresh context. Execute is the maker;
Eval is a different-model, read-only verifier.

- **Explore:** validate the scope gate, map the closest existing entity pattern, record
  baseline gates, and write the failing contract/integration test.
- **Plan:** enumerate every file and approved field mapping. The first real run stops here
  for human approval.
- **Execute:** implement only the approved plan in an isolated worktree and generate the migration.
- **Eval:** independently inspect the migration and run the focused and global gates.

## Guardrails

- **Training mode:** locked on while the pipeline is unproven. The workflow first stops after
  Plan and resumes with `--resume=<run-id> --approved-plan`. It stops again after generating
  the migration and resumes with `--approved-migration`. Removing these stops requires a
  later, reviewed pipeline-definition change after a successful real run is recorded.
- **Isolation:** one pipeline run per git worktree.
- **Database:** the dev database only. Never production, never run a destructive seed reset, never
  `ALLOW_DESTRUCTIVE_DB=1`.
- **Additive only:** no `DROP`, `TRUNCATE`, data rewrite, rename, or destructive column change.
- **Bounds:** maximum 4 recorded build attempts, a 75-minute call-launch window, 7 agent
  calls per invocation, and a declared 60,000-token ceiling. The workflow stops launching
  calls after the time window, but the current API cannot cancel a call already in flight.
  It also does not expose live token metering, so the fixed agent-call cap is the enforceable
  local proxy; a future dispatcher must enforce the token ceiling at launch.
- **No progress:** stop after the same verifier failure occurs twice consecutively.
- **Human checkpoints:** approval of the entity contract, approval of Plan, and approval
  before applying the generated migration.
- **Memory:** append failures and reusable lessons to `agent-loop/memory/errors.md`.

## Status and trigger

Authored but not yet product-proven because the scope-reduction pass found no approved new
entity ticket. Invoke `workflow.js` with a ticket path. The first invocation returns after
Plan; inspect it, then resume with the emitted run ID and `--approved-plan`. After Execute
generates the SQL, inspect that exact file and resume with the same flags plus
`--approved-migration`.
