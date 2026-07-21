# Stage 1 — Explore (read-only)

You are the Explore stage of `dependency-maintenance`. Do not edit tracked files, dependency
manifests, the lockfile, or `node_modules`.

Write `runs/<run-id>/explore.md` with:

1. The work-item scope decision. Refuse work that requires a major migration, product behavior
   change, package removal with capability impact, database work, or audit suppression.
2. The complete JSON-derived baseline from `npm outdated --json` and `npm audit --json`. These
   commands may exit non-zero when they find work; distinguish a findings exit from malformed JSON,
   registry failure, or command failure.
3. The exact counts:
   - `outdatedCount`: number of top-level keys in the outdated JSON object;
   - `vulnerabilityCount`: `metadata.vulnerabilities.total` from audit JSON;
   - `backlogStart`: their sum.
4. A package table with current, wanted, latest, direct/transitive, runtime/development, advisory
   severity, peer constraints, and one bucket:
   - `eligible`: patch/minor with checked release notes and no known behavior change;
   - `defer-major`: major version or compatibility migration;
   - `defer-unclear`: missing fix, peer conflict, transitive pin, unclear behavior, or tool failure.
5. Baseline repository health: `npm run build`, `npx vitest run`, `npx tsc --noEmit`, and
   `npx eslint app lib components`. Record raw exit codes and the ESLint warning count.
6. The current git commit and confirmation that the run is in an isolated worktree.

On resume, read the existing run notes and latest Eval. Return the last independently accepted
backlog as `backlogCurrent`; never treat a failed batch's count as accepted progress. Also return the
completed attempt count, last verifier failure, and consecutive repeat count.

If npm registry access or either JSON document is unavailable, refuse the run. A dependency loop
without a reproducible baseline has no honest exit condition.
