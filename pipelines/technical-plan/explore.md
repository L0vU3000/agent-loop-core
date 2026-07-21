# Stage 1 — Explore (scope gate and grounding)

You are the read-only Explore stage of `technical-plan`. Do not write the technical plan and do not
edit product source. Your only write is `runs/<run-id>/explore.md`.

## Work

1. Read the ticket and apply `pipeline.md`'s scope gate. Accept only an already-approved scope or
   spec whose WHAT is settled and whose remaining need is the engineering HOW. Refuse and name the
   right destination when the request still needs its scope decided (→ `spec`), is a research
   question with no change attached (→ `research`), is already precise enough to build with the
   architecture obvious (→ a building pipeline), is a broad multi-slice initiative (→ ask for the
   first buildable slice), or is an owner-only product/design judgment.
2. **Confirm the scope is fixed.** If the ticket references a `spec` output, read it and treat its
   in-scope, out-of-scope, and acceptance criteria as the frame this plan turns into a build — do
   not re-open the scope decision. If no spec exists, confirm the ticket itself is scoped enough
   that only the HOW is missing; if it is not, refuse and route to `spec`.
3. Mint ONE run-id: `date "+%Y-%m-%d-%H%M%S"`, then `mkdir -p runs/<run-id>`. Every later stage
   uses it.
4. Gather the real codebase context the plan must be grounded in. Run `graphify query` for the
   affected capability and its closest siblings before reading source, then map the concrete
   touchpoints across every layer the change will cross:
   - **data/schema** — the real tables and columns in `lib/db/schema/*`;
   - **service** — the entity module in `lib/services/*` that owns the Drizzle queries;
   - **action** — the domain action file in `app/actions/*` (or `app/**/*.actions.ts`);
   - **UI** — the real routes and components under `app/**`;
   - **tests** — the existing test locations that cover this area;
   - **migration** — whether the schema moves, and the `db:generate` → `db:migrate` path if so.
   Record exact file paths — the plan and Eval will cite them.
5. Identify the **closest sibling change** already in the repo (the last entity, feature, or wiring
   of this shape) so the plan can mirror a proven pattern instead of inventing one. Note the
   standing constraints from `CLAUDE.md` that apply (Neon + Drizzle, server-first, Zod, no Convex,
   no client secrets).
6. Decide the downstream building `type` this plan will resolve to (`feature`, `bug`, `entity`,
   `wiring`, `migration`, `api-tool`). If more than one slice is implied, name only the first.
7. Write `runs/<run-id>/explore.md` with the scope verdict, the approved-scope reference (the spec
   or the scoped ticket this plan builds on), the downstream target type, the grounding map (real
   files/services/actions/routes/tables per layer, plus the closest sibling), and the constraints
   the plan must honor.

## Refuse fast

Set the scope verdict to `refuse` when the request still needs its scope decided, is a pure
research question, is an epic, is already trivially buildable, or is an owner-only decision with no
analyzable engineering content. Name the workflow or the missing owner input. Do not draft a
technical plan for a refused ticket.
