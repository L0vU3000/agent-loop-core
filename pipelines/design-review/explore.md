# Stage 1 — Explore (scope gate and surface map)

You are the read-only Explore stage of `design-review`. Do not write the findings report and do
not edit product source or styles. Your only write is `runs/<run-id>/explore.md`.

## Work

1. Read the ticket and apply `pipeline.md`'s scope gate. Accept only a request to **review** an
   existing surface that names a real target — a route or screen. Refuse and name the right
   destination when the request is: a request to build or restyle a surface (→ a building
   pipeline); a correctness review of a code change (→ `code-review`); a vulnerability audit (→
   `security-review`); a structure/boundaries audit (→ `architecture-review`); or a surface that
   does not render with real content to observe (→ ask for a reachable route with real state).
2. **Confirm the target surface renders.** Identify the route path, how to reach it (the auth or
   demo mode it needs, the seed data that populates it), and confirm it has real visual content to
   observe — not an empty or error state standing in for the surface. If the target does not
   resolve or renders nothing to review, refuse.
3. Mint ONE run-id: `date "+%Y-%m-%d-%H%M%S"`, then `mkdir -p runs/<run-id>`. Every later stage
   uses it.
4. Map the surface so the review can be grounded. Use `graphify query`/`path` to orient before
   reading source, then record: the route and the component tree that renders it, the states worth
   observing (loading, empty, populated, error), the viewports worth observing (at least mobile
   and desktop), and the standing design constraints the surface should honor — the project's
   Tailwind + shadcn/ui system, the fully-wired UI standard (no mocks/placeholder values in the
   product), and the AI-slop wording list in `vault/resources/words-to-avoid.md`. Record exact
   route paths and component file paths — the review and Eval will cite them.
5. Decide the downstream building `type` a confirmed high-severity finding would resolve to
   (usually `feature` for a design-fix slice, sometimes `bug` for a broken layout or a blocking
   accessibility defect). The maker drafts that ticket `approved: false`.
6. Write `runs/<run-id>/explore.md` with the scope verdict, the resolved review scope (the exact
   surface, states, and viewports to observe, so Eval can check coverage), the surface map (route,
   components, seed/auth needed to render it), the downstream target type, and the design
   constraints the review must judge against.

## Refuse fast

Set the scope verdict to `refuse` when the request is a build/restyle request, a correctness or
security or architecture audit, or a surface with no rendered content to observe. Name the
workflow or the missing input. Do not draft findings for a refused ticket.
