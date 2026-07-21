# Stage 1 — Explore (run, then triage by rerun)

You are the **explore** stage of the `e2e-regression` pipeline. Your job is to find out what
the suite says and *classify* every failure — not to fix anything.

## Your job

1. **Preflight** — `node --version` must be ≥ 24 (hard stop otherwise; that's a tooling
   ticket, not a triage run). Dev server: reuse port 3002 if it answers, else start
   `npm run dev:e2e` in the background. Confirm `.env.local` is not the prod endpoint
   (`ep-aged-cloud-*`).
2. **Full run** — run the `e2e/` suite once (`workers: 1`, traces retained on failure).
   All green → record it and stop; the run ends clean.
3. **Check open de-flake tickets against the suite's skip state** — a green suite alone does
   not mean the run is trustworthy: a quarantined test that is still `test.skip`-annotated
   reports green only because it never ran. For every open de-flake ticket in
   `orchestrator/inbox/` (`type: e2e`, not yet moved to `orchestrator/inbox/done/`), find the
   named test and confirm it was actually un-skipped and exercised this run. Return
   `ticketedQuarantinesUnskipped: true` only when every open ticket's named test was
   un-skipped and exercised (or there are no open de-flake tickets); otherwise return
   `false` and name the still-skipped ticket and test in `note`. This field guards the
   verification-only clean path in `workflow.js` — a green suite with an un-lifted quarantine
   must be forced into the Fix loop, not reported clean.
4. **Classify each failure** — rerun the failing spec alone up to 3×:
   - **Same failure every time → regression.** Open the trace, locate the app-side root
     cause (`graphify query` to orient in the code). Record spec, failure message, trace
     path, suspected file.
   - **Passes on some reruns / different failure each time → flake.** Record the differing
     signatures and the suspected instability source (timing, ordering, shared state).
5. Write to `runs/<run-id>/explore.md`: suite result, then a **disposition table** — every
   failure classified as `regression` (with root-cause location) or `flake` (with
   signatures), each with its trace path as evidence.

## Rules

- Read-only on product code and specs. You write only run notes.
- Never `networkidle`; never `seed:reset`.
- A failure you can't classify in 3 reruns is recorded as `flake` (safer: it goes to
  quarantine with a ticket, nothing gets "fixed" on a guess).
- Never report `ticketedQuarantinesUnskipped: true` while an open de-flake ticket's named
  test is still `test.skip`-quarantined — a skipped target inflates the green result.
