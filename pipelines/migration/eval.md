# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit code, the schema, the migration, the
assertion, or run notes other than your verdict file. Report pass/fail with evidence and do not
suggest fixes.

Apply the approved task-specific scorecard in `runs/<run-id>/plan.md` using the shared
[`../EVAL.md`](../EVAL.md) contract. Every check below is critical because the pipeline changes
backend schema and touches a development database.

## Checks

1. Re-read the ticket, Explore notes, and approved Plan. Fail on any change beyond the single
   approved additive change, or any invented field.
2. Confirm the focused schema-presence assertion is unchanged from Explore and went red → green
   for the intended reason (the target object was absent before, present after).
3. Inspect the layers: the Drizzle table definition adds exactly the approved object; any
   exposed Zod field matches; `scripts/schema-assert.ts` names the new object; the tenant
   columns stay non-null; the journal entry exists with a monotonic `when`.
4. Inspect the hand-authored SQL migration. Fail on unrelated drift, `DROP`, `TRUNCATE`, rename,
   type narrowing, or any data-losing rewrite; confirm any backfill only fills the new field.
   Run `npm run db:check` and grade it **relative to the Explore baseline**, the same way ESLint
   is graded: the migration passes only when (a) the manual additive/non-destructive inspection
   above passes, and (b) `db:check` shows no *new* collision versus Explore's recorded baseline.
   This repo carries a pre-existing, accepted `drizzle-kit` snapshot collision (0008/0011) that
   aborts `db:check` upstream of any new migration and gives no signal about it (see
   `vault/decisions/drizzle-only-hand-authored-migrations.md`); an unchanged baseline failure is
   not this run's failure, but any *new* collision the migration introduces is.
5. Confirm the endpoint is the approved development branch, then confirm the migration applied
   cleanly, `npm run db:assert` passes, and the new schema object is present in the live schema.
6. Run `npx vitest run`, `npx tsc --noEmit`, and `npx eslint app lib components`. ESLint may not
   exceed the Explore baseline.

## Verdict format

Write `runs/<run-id>/eval.md`:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
assertion: red→green yes/no; unchanged yes/no
migration: additive yes/no; applies-clean yes/no; db:check no-new-collision-vs-baseline yes/no (report the raw db:check result too)
schema-assert: pass/fail
schema-object-present: yes/no
suite: <passed>/<total>
tsc: <error-count>
eslint: <start> → <current>
evidence: <commands and relevant output>
reason: <one line>
```

Return the same facts in the workflow's structured verdict fields. `migrationAdditive` carries
the manual additive inspection from check 4, `migrationApplies` carries the clean apply from
check 5, `dbCheckPasses` carries the baseline-relative grade (true when the migration is
additive by manual inspection and introduces no new `db:check` collision versus the Explore
baseline, false when it adds a new collision or is destructive), and `schemaAssertPasses`
carries `db:assert`. `verdict: pass` is not sufficient unless every structured boolean is true,
TypeScript has zero errors, and the current ESLint count does not exceed the baseline.

Pass only when the score reaches the approved Plan threshold, the rubric is valid and unchanged,
critical failures are 0, and every mandatory check passes. A high score cannot compensate for an
unsafe migration, a failed apply, or a schema-assert mismatch. On failure, return the complete
scorecard evidence to Plan; do not send it directly to Execute. Re-score all criteria on every
attempt.
