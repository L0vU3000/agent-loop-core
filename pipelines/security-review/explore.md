# Stage 1 — Explore (scope gate and attack-surface map)

You are the read-only Explore stage of `security-review`. Do not write the findings report and do
not edit product source. Your only write is `runs/<run-id>/explore.md`.

## Work

1. Read the ticket and apply `pipeline.md`'s scope gate. Accept only a request to **review** an
   existing change that names a real target — a branch, a diff range, or a PR — for security
   vulnerabilities in this codebase. Refuse and name the right destination when the request is: a
   request to write or fix code (→ a building pipeline); a correctness review (→ `code-review`); a
   structure/boundaries audit (→ `architecture-review`); a visual/UX critique (→ `design-review`);
   a target with no diff to inspect (→ ask for a real change set); or a request to attack a system
   that is not this codebase or to produce a reusable exploit (→ refuse — this pipeline is
   defensive review of Valgate only).
2. **Confirm the target resolves and has a real diff.** Identify the base and head
   (`git diff <base>...<head>`, the PR's changed files, or the named branch against `main`) and
   record the exact files and hunks the change touches. If the target is empty, already merged
   with nothing to inspect, or does not resolve, refuse.
3. Mint ONE run-id: `date "+%Y-%m-%d-%H%M%S"`, then `mkdir -p runs/<run-id>`. Every later stage
   uses it.
4. Map the change against the attack surface so the review can be grounded. Use
   `graphify query`/`path` to orient before reading source, then record, for each changed file:
   its role (service, action, component, schema, route handler, derivation); the mutations and
   data reads it performs; how it authenticates and authorizes the caller; where request input
   (`FormData`, params, body) enters and whether it is Zod-validated before a Drizzle query; what
   it returns to the client on error; any `NEXT_PUBLIC_` env usage or secrets/props crossing into a
   Client Component; and any sensitive action (login, signup, invite, payment) that would need a
   rate limit. Note the standing `CLAUDE.md` **Security Rules** each touchpoint must satisfy
   (authN + authZ + ownership on every mutation, Zod-validate all input, never leak `err.message`,
   no `NEXT_PUBLIC_` secrets, no full DB objects as props, rate-limit sensitive actions). Record
   exact file paths — the review and Eval will cite them.
5. Decide the downstream building `type` a confirmed high-severity finding would resolve to
   (usually `bug` for a fix, sometimes `feature` for a missing control such as rate limiting). The
   maker drafts that ticket `approved: false`.
6. Write `runs/<run-id>/explore.md` with the scope verdict, the resolved review scope (the exact
   files/hunks in the change to be reviewed, so Eval can check coverage), the attack-surface map
   (real files/services/routes/tables/props/env involved and the security rule each must satisfy),
   the downstream target type, and the constraints the review must judge against.

## Refuse fast

Set the scope verdict to `refuse` when the request is a build/fix request, a correctness or
architecture or design audit, a target with no diff to inspect, or an offensive/non-Valgate
request. Name the workflow or the missing input. Do not draft findings for a refused ticket.
