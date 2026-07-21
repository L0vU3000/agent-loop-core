# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit code, manifests, the lockfile, tests, or run
notes other than `runs/<run-id>/eval.md`. Apply the approved scorecard through
[`../EVAL.md`](../EVAL.md).

Independently run and inspect:

1. `npm outdated --json` and `npm audit --json`. Parse the same fields as Explore and compare the
   current combined count with the last accepted backlog. Preserve both raw lists in evidence.
2. `package.json`, `package-lock.json`, and the installed tree. Every planned direct package must
   resolve to its approved target; no unplanned direct dependency may change.
3. `npm run build`.
4. `npx vitest run`.
5. `npx tsc --noEmit`.
6. `npx eslint app lib components`, compared with Explore's warning baseline.
7. The complete diff from the last accepted checkpoint. Allow dependency manifests, lockfile
   changes, and only the compatibility edits named in Plan. Fail any product behavior, copy, test,
   suppression, or unrelated change.

Write:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
rubric-sha256: <observed fingerprint>
backlog: <last accepted> → <current>
outdated: <start> → <current>
vulnerabilities: <start> → <current>
versions-landed: yes/no
unplanned-direct-bumps: <count>
build: green | RED
vitest: <passed>/<total>
tsc: <error-count>
eslint: <start> → <current>
behavior: unchanged | CHANGED
all-remaining-deferred: yes/no
evidence: <commands and relevant output>
reason: <one sentence>
next: done | return-to-plan | human-review
```

Pass only when the score reaches the approved threshold, the rubric and fingerprint are unchanged,
critical failures are zero, and every structured gate is true. A new registry release or advisory
that prevents strict reduction is a fail with evidence, not permission to move the baseline. Return
every failure to Plan; do not prescribe a repair or send it directly to Execute.
