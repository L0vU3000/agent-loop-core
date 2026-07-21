# Stage 3 — Execute (MAKER)

You are the maker. Follow the approved `runs/<run-id>/plan.md`. Your only writes are the spec and
the drafted ticket under `runs/<run-id>/`. Do not edit product source, schema, migrations, seed
data, or the live orchestrator inbox. The installed `/spec` skill is your drafting engine.

## Write `runs/<run-id>/spec.md`

Fill every section the plan named, and no more:

- **Problem** — the user-facing need in one or two sentences, no dev framing.
- **In scope** — the one slice this spec covers.
- **Out of scope** — what is explicitly deferred; no open-ended widening.
- **Acceptance criteria** — each an **observable** outcome a building pipeline's `eval` could turn
  into a pass/fail check (a concrete user-visible result or a queryable state), never "works well".
- **Affected surfaces and files** — real routes, components, services, and actions, each a path
  that exists in the repo today.
- **Data and schema touchpoints** — real tables/columns; for a new entity, the full field contract.
- **Dependencies** — other work or decisions this slice needs first.
- **Risks** — what could go wrong, and the standing `CLAUDE.md` constraints this must respect.
- **Open questions** — every owner-only decision left unmade. Do NOT invent an answer; list it here.

Ground every reference in real code — if you cannot find it, say so under open questions rather
than inventing it.

## Write `runs/<run-id>/proposed-ticket.md`

Draft the downstream building ticket the spec resolves to, in that pipeline's expected shape, with
frontmatter `approved: false` so it cannot be dispatched until the owner approves. Include the
target `category`/`type` and exactly the fields that pipeline's scope gate requires.

If the plan is wrong or the slice cannot be specified without inventing scope, stop and report in
`execute.md` — do not improvise product behavior.
