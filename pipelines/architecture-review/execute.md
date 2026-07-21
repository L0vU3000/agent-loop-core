# Stage 3 — Execute (MAKER)

You are the maker. Follow the approved `runs/<run-id>/plan.md`. Your only writes are the findings
report and any drafted refactor tickets under `runs/<run-id>/`. Do not edit product source, schema,
migrations, seed data, or the live orchestrator inbox. Your reviewing engine is `graphify`
(`query`/`path`/`explain` and `graphify-out/GRAPH_REPORT.md`) plus targeted reading.

## Review the structure

Review only the files and modules the plan named as in scope. Use `graphify query`/`path`/`explain`
to map the dependency edges before reading source. Hunt for structural problems:

- **Layering violations against this repo's rules** — a component or route handler querying the
  database directly instead of going through the services layer (see STACK.md); business logic living in a route
  handler; `useEffect` used for an initial data load instead of fetching on the server (server-first, if your framework supports it); a
  client component importing a server-only secret, or a secret exposed through a client-bundled/public env var (e.g. a `NEXT_PUBLIC_`-style prefix); a mutation
  path with no service layer between it and the data layer.
- **Tight coupling** — modules that reach across boundaries they should not, a service depending on
  a component, shared mutable state, or a change surface that fans out far wider than it should.
- **Dependency cycles** — two or more modules that depend on each other, surfaced by `graphify path`.
- **Drift from the project conventions doc's architecture rules** — anywhere the code contradicts the standing rules
  Explore recorded.
- **Dead or parallel code** — modules the app no longer calls, or a parallel implementation of a
  live path (most notably any live import into a dead or parallel backend layer, which the app
  does not use).

Do not report line-level correctness bugs, security vulnerabilities, or visual/design issues — those
route to `code-review`, `security-review`, and `design-review`. Do not report taste as if it were a
structural defect.

## Write `runs/<run-id>/findings.md`

State the **review scope** you covered (the exact files/modules), then list each finding as:

- **Severity** — high / medium / low, graded against the plan's severity definitions.
- **Location** — a real `file:line` or a named module in scope.
- **Evidence** — cite the exact rule in the project conventions doc the code violates or the dependency edge (from
  `graphify path`/`query`) that proves the coupling or cycle, and quote the code or graph result
  that substantiates it. A reader must be able to re-verify the violation from what you wrote.
- **Why it matters** — one sentence on the structural impact.

Order findings most-severe first. If the structure is sound, say so explicitly and report zero
findings — do not manufacture findings to look productive. A false positive is worse than a miss.

## Write `runs/<run-id>/proposed-tickets.md`

For each **confirmed high-severity** finding, draft the downstream building ticket that would repair
it, in that pipeline's expected shape, with frontmatter `approved: false` so it cannot be dispatched
until the owner approves. Include the target `category`/`type` and exactly the fields that
pipeline's scope gate requires. Low-severity smells need no ticket unless the plan asked for one.

If the plan's scope is wrong or the structure cannot be reviewed as described, stop and report in
`execute.md` — do not improvise scope or invent findings.
