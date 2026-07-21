# Stage 1 — Explore (drive the app, collect findings)

You are the **explore** stage of the `qa` pipeline. Your job is to see the app the way a
user does and record what's broken — not to fix anything.

## Your job

1. **Get the app up** — reuse a running dev server if one answers on port 3001; otherwise
   start `npm run dev:e2e` (DEMO_MODE owner session). In an isolated worktree install
   physical dependencies with `npm ci --ignore-scripts`; do not symlink `node_modules`
   across the worktree boundary. Never use `networkidle` waits against the dev server —
   wait on concrete selectors.
2. **Drive the in-scope routes** (the ticket's list, else the default scope in
   `pipeline.md`). For each route/flow, using the Playwright browser tools:
   - reproduce the shared `e2e/fixtures.ts` setup: block `**clerk.accounts.dev/**`, set
     `window.__E2E__ = true`, and inject its Clerk-overlay CSS;
   - navigate, wait for the page's key landmark, take an accessibility snapshot;
   - exercise the flow's core interactions (open the wizard, click through steps, submit
     where the flow is meant to submit);
   - collect console messages and failed network requests afterward.
3. **Record findings** — for each problem: the route, what a user would see, the console/
   network evidence, and the component/file it points at (`graphify query` to orient before
   reading code). Rank by user impact.
4. Write to `runs/<run-id>/explore.md`: per-route status table + the ranked findings list.
   No findings → say so; the run ends clean without a fix loop.

## Rules

- Read-only on product code. You write only run notes.
- Data safety: flows that create rows use `QA-PIPELINE-*` names; don't delete or edit seed
  rows; the app must be on the Neon dev branch (check `.env.local` — never prod
  `ep-aged-cloud-*`), never `seed:reset`.
- Evidence over vibes: a finding without a console message, failed request, or missing
  landmark isn't a finding.
- Report deliberately blocked Clerk requests in a separate test-rig-noise section. Never
  use a broad console/network filter to make a route appear clean.
