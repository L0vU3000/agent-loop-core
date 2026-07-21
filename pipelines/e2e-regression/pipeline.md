---
name: e2e-regression
category: testing
type: e2e
---

# Pipeline: e2e-regression

> **Pipeline #5 — keep the end-to-end signal trustworthy.** Runs the Playwright `e2e/`
> suite, triages every failure into *regression* (deterministic — fix the app) or *flake*
> (non-deterministic — quarantine the test, never delete it), and leaves the blocking suite
> meaning what it says: green = the app works.

## Goal

The `e2e/` suite is green, and every failure that ever shows up is either fixed at the app's
root cause or explicitly quarantined with a ticket — never ignored, never deleted.

## Exit condition (the check)

A run **passes** only when ALL are true:

1. The e2e suite is **green twice in a row** in the verifier's own runs (two consecutive
   full passes — one pass can be luck; two catches most non-determinism cheaply).
2. Every failure found during the run is dispositioned: **regression → fixed** (with the
   trace as evidence) or **flake → quarantined** (annotated skip + an inbox ticket to
   de-flake it). No silent deletions, no bare `.skip` without a ticket.
3. Global no-regression gates: `npx vitest run` green · `npx tsc --noEmit` 0 errors ·
   `npx eslint app lib components` no new warnings.

## Verification technique (researched 2026-07-15)

**Chosen: deterministic-rerun triage + quarantine policy + trace evidence.**

- **Why rerun-to-classify:** an e2e failure is only a regression if it reproduces. The 2026
  playbooks converge on classifying by failure signature across reruns — same failure every
  time = regression; varying/alternating = flake
  ([flaky-test diagnostic playbook](https://testquality.com/playwright-flaky-tests-diagnostic-playbook-2026/),
  [retries & flake handling guide](https://qaskills.sh/blog/playwright-retries-flaky-test-handling-guide)).
  This pipeline reruns a failing spec up to 3× to classify before anyone touches code.
- **Why quarantine, not delete:** the blocking suite must only contain trustworthy tests —
  a green check has to mean the app works. Flaky tests move to an annotated skip with a
  ticket so the coverage debt stays visible
  ([TestDino flaky-test guide](https://testdino.com/blog/playwright-flaky-tests)).
- **Why traces:** `retain-on-failure` traces are the ground truth for *why* a spec failed;
  the eval cites them instead of re-guessing. Fix verification for a regression = the
  previously failing spec passes, plus the two consecutive full-suite passes.
- **Why two consecutive green runs as the exit:** statistical certainty is out of budget
  (the suite is minutes long); two consecutive passes is the cheapest check that still
  catches most instability, and the quarantine path handles what slips through.

Recorded in [`memory/decisions.md`](../../memory/decisions.md).

## Running the suite (the landmines — from memory `project_e2e_suite`)

- Runner needs **Node ≥ 24** (Node 22 + Playwright loader bug).
- Server: `npm run dev:e2e` (DEMO_MODE owner session), `workers: 1`.
- Never `networkidle` waits against the dev server.
- **Never `seed:reset`.** The app points at the Neon dev branch.
- The real-Clerk `auth` project (`npm run test:e2e:auth`, port 3002) is a separate, slower
  lane — only in scope when the ticket asks for it.

## Stages

`explore → plan → execute → eval`, separate agents; `execute` is the **maker**, `eval` is a
**separate verifier** on a different model.

- **explore** — run the suite once; for each failure, rerun that spec up to 3× and classify
  by failure signature: deterministic → regression (locate the app-side root cause via the
  trace), non-deterministic → flake. Record traces.
- **plan** — per regression: smallest app-side fix. Per flake: the quarantine annotation +
  the de-flake ticket text. Escalate anything needing product judgment.
- **execute** — apply fixes / quarantine annotations exactly as planned. Fixing the *app* is
  the default; changing a *test* is only allowed when the plan shows the test itself is
  wrong (asserts outdated behavior) — and says so explicitly.
- **eval** — rerun the previously failing specs, then the full suite **twice**; check the
  disposition table and global gates.

## Guardrails

- **Isolation:** run in a git worktree; one dev server per run.
- **Bounds:** `max-iterations: 4`, `max-time: 90m` (e2e minutes are expensive).
- **Test edits are suspect by default:** eval diffs every changed spec; a weakened assertion
  is a fail (same rule as bug-fix's gutted-test guard).

## How to run it

- Work item lands in `orchestrator/inbox/` with `type: e2e`.
- **First run — by hand** (prove the suite even runs in this workspace: Node version,
  server port, seed state), then automate via `workflow.js`.
- Failures / surprises → [`../../memory/errors.md`](../../memory/errors.md).
