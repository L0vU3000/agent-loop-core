---
name: qa
category: testing
type: qa
---

# Pipeline: qa

> **Pipeline #4 — the app as the user sees it.** Browser-drives key routes, finds broken
> flows and console errors, fixes them, and has a separate verifier re-drive the same flows
> in a fresh browser session. Catches the class of bug the unit suite can't: wiring, routing,
> hydration, dead buttons.

## Goal

Every route/flow in the run's scope loads, its key interactions complete, and the browser
console is free of errors — verified by an agent that didn't write the fixes.

## Exit condition (the check)

A run **passes** only when ALL are true, verified by `eval` in a **fresh browser session**:

1. Every in-scope flow completes: the pages render their key landmarks (ARIA/structural
   check, not pixels) and the interactions the flow needs actually work.
2. **Zero product console errors** on every in-scope route (warnings are recorded, not
   failed). Requests deliberately blocked by the shared e2e fixture are recorded separately
   as test-rig noise rather than hidden or counted as product failures.
3. **No failed network requests** (4xx/5xx) triggered by normal flow usage — expected 401/403
   on auth-gated probes excepted.
4. Global no-regression gates: `npx vitest run` green · `npx tsc --noEmit` 0 errors ·
   `npx eslint app lib components` no new warnings.

## Verification technique (researched 2026-07-15)

**Chosen: browser-driven interaction testing with structural (ARIA-level) assertions +
console/network capture. Pixel visual regression deliberately excluded.**

- **Why browser-driven:** this pipeline's failure class (broken wiring, dead flows,
  hydration errors) only manifests in a real browser; no unit-level check can stand in.
- **Why structural, not pixels:** the 2026 consensus is that ARIA/semantic snapshots are the
  right altitude for flow verification — deterministic across OS/GPU/font stacks — while
  `toHaveScreenshot` pixel baselines flake unless pinned to one rendering environment and
  scoped to components ([playwright.dev/docs/aria-snapshots](https://playwright.dev/docs/aria-snapshots),
  [playwright.dev/docs/test-snapshots](https://playwright.dev/docs/test-snapshots),
  [visual-regression guide](https://testquality.com/playwright-visual-regression-guide/)).
  This pipeline runs on a dev machine, not a pinned CI image, so pixel baselines would fail
  for reasons that aren't bugs. If a layout-critical surface ever needs pixel checks, add a
  component-scoped `toHaveScreenshot` with masking as its own work item.
- **Why a fresh session for eval:** the maker's browser state (cookies, localStorage, cached
  chunks) can hide breakage; the verifier starts clean, the way a user arrives.
- **Console/network capture** is the cheap, airtight half of the check: a flow can *look*
  fine while the console streams hydration errors — those are failures here.

Recorded in [`memory/decisions.md`](../../memory/decisions.md).

## Stages

`explore → plan → execute → eval`, separate agents; `execute` is the **maker**, `eval` is a
**separate verifier** on a different model, driving its own fresh browser session.

- **explore** — start the app (see "App under test"), drive the in-scope routes with the
  Playwright tools, record per-route: loads? key landmarks present? console errors? failed
  requests? → a findings list with evidence (messages, selectors, URLs).
- **plan** — for each finding: root cause hypothesis and the smallest fix. Escalate design
  decisions instead of guessing.
- **execute** — apply the fixes in code.
- **eval** — fresh browser session; re-drive every in-scope flow; run the four checks above.

## App under test

- Server: `npm run dev:e2e` — the DEMO_MODE owner session on port **3001**. Port 3002 is
  reserved for the separate real-Clerk auth project. Reuse a server that's already up;
  start one if not.
- **Never `networkidle`** waits against the dev server (known hang); wait on selectors.
- **Reuse the shared browser fixture behavior in `e2e/fixtures.ts`:** block
  `**clerk.accounts.dev/**`, set `window.__E2E__ = true`, and inject its Clerk-overlay CSS.
  The blocked hosted Clerk request is expected test-rig noise. Do not add broader ignore
  rules for ordinary product requests or console errors.
- Data: the app points at the **Neon dev branch** (`.env.local`). Flows that create rows use
  recognizable names (`QA-PIPELINE-*`) and clean up after themselves where a delete surface
  exists. Never prod, **never `seed:reset`**.

## Default route scope (a ticket can override)

`/` · `/property/PROP-0001/overview` · `/property/PROP-0001/documents` ·
`/property/PROP-0001/ownership` · `/settings` · `/add-property` through the import-method
step · the ownership wizard through its loaded structure step (regression: co-owner
data-loss). A ticket can supply a different valid seed property ID.

## Guardrails

- **Isolation:** run in a git worktree; one dev server per run.
- **Turbopack worktrees need physical dependencies:** run `npm ci --ignore-scripts` inside
  an isolated worktree. A `node_modules` symlink outside that worktree makes Turbopack
  reject the project root.
- **Bounds:** `max-iterations: 5`, `max-time: 60m`.
- **Fix scope:** wiring/flow fixes only. A finding that needs product/design judgment is
  reported, not guessed at.

## How to run it

- Work item lands in `orchestrator/inbox/` with `type: qa` (optionally listing routes).
- **First run — by hand** to prove the drive→fix→re-drive shape, then automate via
  `workflow.js`.
- Failures / surprises → [`../../memory/errors.md`](../../memory/errors.md).
