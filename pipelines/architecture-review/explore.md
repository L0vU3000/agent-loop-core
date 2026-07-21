# Stage 1 — Explore (scope gate and structure map)

You are the read-only Explore stage of `architecture-review`. Do not write the findings report and
do not edit product source. Your only write is `runs/<run-id>/explore.md`.

## Work

1. Read the ticket and apply `pipeline.md`'s scope gate. Accept only a request to **review the
   structure** of an existing subsystem, module, or the whole repo. Refuse and name the right
   destination when the request is: a request to build or refactor code (→ a building pipeline); a
   line-level correctness review of a diff or PR (→ `code-review`); a vulnerability audit (→
   `security-review`); a visual/UX critique (→ `design-review`); or a target that names no
   resolvable subsystem (→ ask for a real region to review).
2. **Confirm the target resolves.** Identify exactly which files and modules the named subsystem
   covers (a directory such as `lib/services/*`, a feature area such as add-property, or the whole
   repo). If the target does not resolve to real code, refuse.
3. Mint ONE run-id: `date "+%Y-%m-%d-%H%M%S"`, then `mkdir -p runs/<run-id>`. Every later stage
   uses it.
4. Map the structure so the review can be grounded. Use `graphify query`/`path`/`explain` and
   `graphify-out/GRAPH_REPORT.md` to orient before reading source, then record:
   - the in-scope files and their layer/role (component, route handler, server action, service,
     schema, derivation);
   - the **dependency edges** between them — especially any edge that crosses a layer boundary the
     rules forbid (a component or route handler reaching the database directly instead of through
     `lib/services/*`, business logic living in a route handler, `useEffect` for an initial data
     load, a client component importing a server-only secret);
   - any **dependency cycles** the graph reveals;
   - **dead or parallel code** in scope — most notably the archived `archive/convex/` layer the app
     does not call, and any other unreachable or duplicated module;
   - the standing `CLAUDE.md` architecture rules that apply (default to Server Components; fetch in
     Server Components, never `useEffect` for initial loads; one action file per domain; Server
     Actions → `lib/services/*` for anything touching the DB; Neon + Drizzle, not Convex; no secrets
     to the client). Record exact file paths and the rule text — the review and Eval will cite them.
5. Decide the downstream building `type` a confirmed high-severity finding would resolve to (usually
   `wiring` or `feature` for a structural repair, sometimes `bug` when the violation causes a
   concrete fault). The maker drafts that ticket `approved: false`.
6. Write `runs/<run-id>/explore.md` with the scope verdict, the resolved review scope (the exact
   files/modules under review, so Eval can check coverage), the structure map (dependency edges,
   cycles, dead/parallel code, and the layer of each in-scope file), the applicable `CLAUDE.md`
   rules, the downstream target type, and the constraints the review must judge against.

## Refuse fast

Set the scope verdict to `refuse` when the request is a build/refactor request, a line-level code
review, a security or design audit, or a target with no resolvable subsystem. Name the workflow or
the missing input. Do not draft findings for a refused ticket.
