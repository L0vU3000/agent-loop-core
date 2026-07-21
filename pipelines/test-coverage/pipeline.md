---
name: test-coverage
category: testing
type: test
---

# Pipeline: test-coverage

> **Pipeline #3 — strengthens the substrate.** Picks an untested `lib/services/*` module and
> writes real unit tests for it. Every other pipeline's eval leans on "the suite is green",
> so making the suite *mean more* is the highest-leverage testing work. The verification
> below is deliberately stronger than "the new tests pass" — a passing test that can't catch
> a bug is worthless.

## Goal

The chosen target module has focused, honest tests: its statement/branch coverage goes up,
and the new tests demonstrably **kill injected bugs** (mutation testing), not just execute
lines.

## Exit condition (the check)

A run **passes** only when ALL are true:

1. The **new tests pass** (and are red if the behavior they describe is broken — spot-checked
   by mutation, below).
2. **Coverage up:** statement coverage of the target module is **strictly higher** than the
   baseline `explore` recorded (measured with `@vitest/coverage-v8`).
3. **Mutation score:** StrykerJS scoped to the target module reports a mutation score at or
   above the threshold the plan committed to (default **60%**). Surviving mutants are listed
   in the eval evidence.
4. Global no-regression gates: `npx vitest run` whole suite green · `npx tsc --noEmit` 0
   errors · `npx eslint app lib components` no new warnings.

## Verification technique (researched 2026-07-15)

**Chosen: coverage measurement (v8 provider) + mutation testing (StrykerJS vitest runner).**

- **Why coverage alone is not the check:** coverage proves lines *ran*, not that assertions
  would fail when the code is wrong. The pipeline's product is trustworthy tests, so the
  verification must measure bug-catching power directly. Mutation testing does exactly that:
  it injects small bugs (mutants) and counts how many the tests kill.
- **Why `@vitest/coverage-v8`:** since Vitest 3.2 the v8 provider remaps coverage through the
  AST, producing Istanbul-identical reports at 2–5× the speed ([vitest.dev/guide/coverage](https://vitest.dev/guide/coverage),
  [v8-vs-istanbul comparison](https://dev.to/stevez/v8-coverage-vs-istanbul-performance-and-accuracy-3ei8)).
  Istanbul would only matter for compliance-grade branch counting we don't need.
- **Why StrykerJS and not agent-applied mutations:** the eval stage is **read-only** — a
  verifier that edits source to inject mutants breaks that rule and grades its own edits.
  Stryker keeps the verifier read-only: the *tool* mutates in a sandbox, the verifier just
  runs it and reads the score. The vitest runner (`@stryker-mutator/vitest-runner`, added in
  StrykerJS 7, actively maintained) uses perTest coverage analysis, so runs scoped to one
  module stay fast ([stryker-mutator.io vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)).
- **Scope control:** always pair `--mutate 'lib/services/<target>.ts'` with
  `--testFiles 'lib/services/<target>.test.ts'` and `--testRunner vitest`. This proves the
  target's focused tests can kill its mutants without getting accidental help from the
  rest of the suite. Never run whole-repo mutation; this pipeline works one module at a
  time.

Recorded in [`memory/decisions.md`](../../memory/decisions.md).

## Stages

`explore → plan → execute → eval`, separate agents; `execute` is the **maker**, `eval` is a
**separate verifier** on a different model.

- **explore** — measure baseline coverage, pick the highest-value untested `lib/services/*`
  module, list the behaviors worth testing, and decide the **test lane** (below).
- **plan** — enumerate concrete test cases (happy path, edge, error) and commit to a
  mutation-score threshold.
- **execute** — write the tests. Product code is off-limits: if a test can't be written
  without changing the module, report why instead of "fixing" it.
- **eval** — run the four checks above, cite output, rule pass/fail.

## Test lanes (explore picks one per module)

- **Default lane (preferred):** DB-free tests in the main suite — mock the Drizzle `db`
  client or test pure logic (mapping, validation, derivation). Fast, runs everywhere.
- **Live-DB lane:** `*.db.test.ts` under `vitest.config.db.ts` for modules that are nothing
  but queries. These hit the **Neon dev branch** via `DATABASE_URL` from `.env.local`.
  Rules: confirm the branch is dev before writing (never prod `ep-aged-cloud-*`), **never
  `seed:reset`**, create-your-own rows with recognizable ids and delete them afterward —
  never mutate or delete seed rows.

## Guardrails

- **Isolation:** run in a git worktree.
- **Tests only:** `execute` writes test files (and test helpers); it does not change product
  code. A module too tangled to test is a *finding*, not a refactor license.
- **Bounds:** `max-iterations: 5`, `max-time: 45m`.
- **Honest failure:** if the mutation score can't reach the threshold, report which mutants
  survive and why — do not pad tests with assertion-free calls to inflate coverage.

## How to run it

- Work item lands in `orchestrator/inbox/` with `type: test` (optionally naming a target
  module; otherwise explore picks one).
- **First run — by hand** (prove coverage + Stryker actually work against vitest 4 / Vite 8),
  then automate via `workflow.js`.
- Failures / surprises → [`../../memory/errors.md`](../../memory/errors.md).
