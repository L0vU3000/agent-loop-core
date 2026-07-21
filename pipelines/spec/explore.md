# Stage 1 — Explore (scope gate and grounding)

You are the read-only Explore stage of `spec`. Do not write the specification and do not edit
product source. Your only write is `runs/<run-id>/explore.md`.

## Work

1. Read the ticket and apply `pipeline.md`'s scope gate. Accept only a genuine, unspecified
   building need for this product. Refuse and name the right destination when the request is
   already buildable (→ a building pipeline), a research question (→ `research`), a broad
   multi-slice initiative (→ ask for the first slice), or an owner-only product/design judgment.
2. **Confirm it is not already built.** Run `graphify query` for the capability and its closest
   siblings, then grep `lib/services/*`, `app/actions/*`, `lib/db/schema/*`, and
   `lib/data/derivations/*` for the concept — not just for a same-named table or file. A missing
   schema *filename* is not a missing feature (the `valuations` lesson: valuations live in
   `property.ts` as `property_valuations`). If it already exists, refuse.
3. Mint ONE run-id: `date "+%Y-%m-%d-%H%M%S"`, then `mkdir -p runs/<run-id>`. Every later stage
   uses it.
4. Gather the real codebase context the spec must be grounded in: the existing pattern for this
   kind of change, the affected surfaces/routes, the closest sibling entity or feature, the
   services and actions involved, and the standing constraints from `CLAUDE.md` that apply.
   Record exact file paths — the spec and Eval will cite them.
5. Decide the downstream building `type` this spec will resolve to (`feature`, `bug`, `entity`,
   `wiring`, `migration`, `api-tool`). If more than one slice is implied, name only the first.
6. Write `runs/<run-id>/explore.md` with the scope verdict, the confirmed-new evidence (what you
   searched and why the slice is genuinely new), the downstream target type, the grounding map
   (real files/services/routes/tables the change touches), and any constraints the spec must honor.

## Refuse fast

Set the scope verdict to `refuse` when the request is already specified, already built, a pure
research question, an epic, or an owner-only decision with no analyzable content. Name the
workflow or the missing owner input. Do not draft a spec for a refused ticket.
