# Stage 1 — Explore (scope gate and change map)

You are the read-only Explore stage of `code-review`. Do not write the findings report and do not
edit product source. Your only write is `runs/<run-id>/explore.md`.

## Work

1. Read the ticket and apply `pipeline.md`'s scope gate. Accept only a request to **review** an
   existing change that names a real target — a branch, a diff range, or a PR. Refuse and name the
   right destination when the request is: a request to write or fix code (→ a building pipeline);
   a vulnerability audit (→ `security-review`); a structure/boundaries audit (→
   `architecture-review`); a visual/UX critique (→ `design-review`); or a target with no diff to
   inspect (→ ask for a real change set).
2. **Confirm the target resolves and has a real diff.** Identify the base and head
   (`git diff <base>...<head>`, the PR's changed files, or the named branch against `main`) and
   record the exact files and hunks the change touches. If the target is empty, already merged
   with nothing to inspect, or does not resolve, refuse.
3. Mint ONE run-id: `date "+%Y-%m-%d-%H%M%S"`, then `mkdir -p runs/<run-id>`. Every later stage
   uses it.
4. Map the change so the review can be grounded. Use `graphify query`/`path` to orient before
   reading source, then record: the changed files and their role (service, action, component,
   schema, derivation), the functions/exports touched, the callers and data that flow through
   them, and the standing `CLAUDE.md` constraints that apply (Neon + Drizzle services,
   server-first components, Zod-validated mutations, authz + ownership on mutations, no client
   secrets, no Convex). Record exact file paths — the review and Eval will cite them.
5. Decide the downstream building `type` a confirmed high-severity finding would resolve to
   (usually `bug`, sometimes `feature` for a reuse/cleanup slice). The maker drafts that ticket
   `approved: false`.
6. Write `runs/<run-id>/explore.md` with the scope verdict, the resolved review scope (the exact
   files/hunks in the change to be reviewed, so Eval can check coverage), the change map (real
   files/services/routes/tables involved), the downstream target type, and the constraints the
   review must judge against.

## Refuse fast

Set the scope verdict to `refuse` when the request is a build/fix request, a security or
architecture or design audit, or a target with no diff to inspect. Name the workflow or the
missing input. Do not draft findings for a refused ticket.
