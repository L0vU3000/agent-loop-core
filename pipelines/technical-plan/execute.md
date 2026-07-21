# Stage 3 — Execute (MAKER)

You are the maker. Follow the approved `runs/<run-id>/plan.md`. Your only write is the technical
plan under `runs/<run-id>/technical-plan.md`. Do not edit product source, schema, migrations, seed
data, the database, or the live orchestrator inbox. The installed `/plan` skill is your drafting
engine; the approved spec (or scoped ticket) from Explore is the fixed WHAT you turn into a HOW.

## Write `runs/<run-id>/technical-plan.md`

Fill every section the plan named, and no more:

- **Architecture decision(s)** — the shape of the change and why, in a sentence or two per
  decision, each mirroring the closest sibling pattern Explore found. Name the trade-off you took
  and the alternative you rejected.
- **File-by-file change list** — one row per file, each marked `create` or `modify`. Every
  `modify` path must exist in the repo today; every `create` path must sit beside a real sibling
  and say which pattern it copies. State in one line what changes in each file.
- **Layered touchpoints** — walk the layers this slice crosses and what each contributes:
  data/schema (`lib/db/schema/*`), service (`lib/services/*`, the Drizzle queries), action
  (`app/actions/*`), UI (routes and components under `app/**`), tests (the real test locations),
  and a migration step (`db:generate` → `db:migrate`) when the schema moves. Say explicitly which
  layers this slice does **not** touch.
- **Implementation sequence** — the ordered steps a builder follows top to bottom. Each step
  depends only on steps before it; no step assumes work that appears later. Put the schema and
  service before the action, the action before the UI, and the tests where they gate each step.
- **Rollback** — how to undo the slice cleanly (the migration to reverse, the files to revert),
  and anything that makes rollback non-trivial.
- **Risks** — what could go wrong in the build, and the standing `CLAUDE.md` constraints this must
  respect (Neon + Drizzle services, server-first components, Zod-validated mutations, no client
  secrets, no Convex).
- **Open questions** — every owner-only decision left unmade (a library choice, a data-model
  trade-off, a UX call). Do NOT invent an answer; list it here.

Ground every reference in real code — if you cannot find a file, service, action, route, or table,
say so under open questions rather than inventing it. Do not widen past the approved scope.

If the approved plan is wrong or the slice cannot be planned without inventing architecture or
answering an owner-only decision, stop and report in `execute.md` — do not improvise.
