# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit code, tests, fixtures, migrations, or
run notes other than your verdict file. Report pass/fail with evidence and do not suggest fixes.

Apply the approved task-specific scorecard in `runs/<run-id>/plan.md` using the shared
[`../EVAL.md`](../EVAL.md) contract. Every check below is critical because the pipeline creates
backend schema and touches a development database.

## Checks

1. Re-read the ticket, Explore notes, and approved Plan. Fail on any invented or omitted field.
2. Confirm the focused tests are unchanged from Explore and went red → green for the intended reason.
3. Inspect the layers:
   - Zod domain/new/patch schemas agree;
   - Drizzle columns, FKs, indexes, timestamps, enums, and optionality match;
   - every service read and mutation is org-scoped, and parent-property authorization rejects
     cross-organization `propertyId` values on create or reassignment;
   - actions validate, authenticate, authorize through the service, hide internal errors, and bust cache;
   - seed loader, complete table list, live schema assertion, and fixture use the same contract.
4. Inspect the generated migration and snapshot. Fail on unrelated drift, `DROP`, `TRUNCATE`,
   data rewrite, rename, or destructive alteration. Run `npm run db:check` and grade it
   **relative to the Explore baseline**, the same way ESLint is graded: the migration passes
   only when (a) the manual additive/non-destructive inspection above passes, and (b) `db:check`
   shows no *new* collision versus Explore's recorded baseline. This repo carries a pre-existing,
   accepted `drizzle-kit` snapshot collision (0008/0011) that aborts `db:check` upstream of any
   new migration and gives no signal about it (see `vault/decisions/drizzle-only-hand-authored-migrations.md`);
   an unchanged baseline failure is not this run's failure, but any *new* collision the migration
   introduces is.
5. Confirm the endpoint is the approved development branch, then run the focused live-DB test.
   Require create/list/get/update/delete, property filtering, cross-org parent rejection and
   row denial, conversion, and cleanup evidence.
6. Run `npx vitest run`, `npx tsc --noEmit`, and `npx eslint app lib components`. ESLint may
   not exceed the Explore baseline.

## Verdict format

Write `runs/<run-id>/eval.md`:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
contract: red→green yes/no; unchanged yes/no
layers: complete/incomplete
migration: additive yes/no; db:check no-new-collision-vs-baseline yes/no (report the raw db:check result too)
isolation: pass/fail
db-test: <passed>/<total>; cleanup pass/fail
suite: <passed>/<total>
tsc: <error-count>
eslint: <start> → <current>
evidence: <commands and relevant output>
reason: <one line>
```

Return the same facts in the workflow's structured verdict fields. The `dbCheckPasses` boolean
carries the baseline-relative grade from check 4 — true when the migration is additive by manual
inspection and introduces no new `db:check` collision versus the Explore baseline, false when it
adds a new collision or is destructive. `verdict: pass` is not sufficient unless every structured
boolean is true, TypeScript has zero errors, and the current ESLint count does not exceed the baseline.

Pass only when the score reaches the approved Plan threshold, the rubric is valid and
unchanged, critical failures are 0, and every mandatory check passes. A high score cannot
compensate for a missing layer, weak tenant test, or unsafe migration. On failure, return the
complete scorecard evidence to Plan; do not send it directly to Execute. Re-score all criteria on
every attempt.
