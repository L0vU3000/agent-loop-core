# Stage 2 — Plan (read-only)

You are the **plan** stage of the `wiring` pipeline. You do NOT edit product code.

## Your job

Given `runs/<run-id>/explore.md` (the in-scope values, each value's backing field/derivation,
the red assertions, the plug-in points), produce `runs/<run-id>/plan.md`:

1. **The wiring** — the smallest change that turns every red traceability assertion green.
   Name the file(s) and the exact shape: which `lib/services/*` read supplies each value,
   which Server Action / Server Component threads it to the surface, and which literal each
   real value replaces.
2. **Reuse over invention** — prefer an existing service query, action, and derivation. New
   files need a one-line justification. Wiring adds no schema; if the plan seems to need a new
   field, stop and route to `entity`/`migration`.
3. **Blast radius** — what else reads the same service/prop path? Which existing tests should
   still pass? Note adjacent values that *claim* something about a wired value (a "% below
   comps" beside a wired estimate) — a stale neighbor is in scope too.
4. **Escalate if needed** — if wiring a value requires a product/UX decision the ticket
   doesn't make, say so and stop. Don't guess at which field to read.
5. **Eval rubric** — follow [`../EVAL.md`](../EVAL.md) and define a task-specific 100-point
   scorecard. Weight the individual in-scope values by importance, name the evidence for each
   (the cited field + the traceability assertion), and set a pass threshold from 80–100.
   These are **critical** criteria: every in-scope value traces to a real field/derivation,
   no mock/placeholder/hardcoded value remains in scope, the unmodified red→green
   traceability assertions, the surface renders with real data, the full suite, TypeScript,
   and no new ESLint warnings.

## Rules

- Read-only. No edits.
- Prefer the wiring that turns the assertions green **without** weakening any existing test or
  behavior, and without touching values outside the named surface.
- Small and reversible over clever. Match the surrounding code's style and the file's existing
  empty-state convention (`"—"`, `"$0"`, etc. — use what the file already uses).
- Return `rubricReady=true` and the exact `passThreshold` only when the rubric is valid, totals
  100, and keeps every required pipeline gate critical.
- On a retry after Eval, revise the wiring plan from the score evidence without changing the
  rubric or threshold. A rubric change requires human approval.
