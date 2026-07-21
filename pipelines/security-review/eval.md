# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit the findings, the tickets, or any file other
than your verdict. Report pass/fail with evidence and do not add your own findings or rewrite the
maker's.

Apply the approved task-specific scorecard in `runs/<run-id>/plan.md` using the shared
[`../EVAL.md`](../EVAL.md) contract. Your job is adversarial: take each reported vulnerability and
try to **disprove it**. A security findings list is only as valuable as it is trustworthy, so drop
anything you cannot stand up.

## Checks

1. **Findings verified (critical)** — for every reported finding, independently trace the
   unauthorized path (which caller, which resource id, which missing check lets the attack through)
   or re-read the cited `file:line` with `graphify` and targeted reads to confirm the code actually
   is unsafe in the way claimed.
2. **No false positives (critical)** — **drop** any finding you cannot stand up: the "missing"
   authz/ownership check actually exists in a shared helper upstream, the input is already Zod-
   validated before the query, the value is not truly a secret, or the client only receives selected
   fields. Record what you dropped and why. A hallucinated or unreproducible vulnerability that
   survives to the owner is a critical failure of this pipeline.
3. **Evidence cited (critical)** — every surviving finding resolves to a real `file:line`, quotes the
   exact vulnerable code, and states a concrete exploit/impact (the request and the data reached). A
   finding whose evidence does not resolve fails.
4. **Severity justified (critical)** — each surviving finding's severity matches the plan's severity
   definitions; a hardening gap with no reachable exploit labeled high, or a preference dressed as a
   live vulnerability, is a severity failure.
5. **Scope covered (critical)** — the review's declared scope and rule coverage match the target's
   actual diff (`git diff <base>...<head>` / the PR's changed files). A review that silently skipped
   part of the change, or a rule that applied and was not checked, fails.
6. **Valid drafted ticket** — for each confirmed high-severity finding, `proposed-tickets.md`
   carries a ticket targeting a real building `category`/`type` with that pipeline's required
   fields, marked `approved: false`.
7. **Read-only + advisory + defensive** — the maker edited no product source, wrote no reusable
   exploit; findings only propose.

## Verdict format

Write `runs/<run-id>/eval.md`:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
findings-verified: all-traced yes/no (list any that were not)
false-positives: dropped <count> (list each dropped finding + why)
evidence-cited: all-resolve yes/no
severity-justified: yes/no
scope-covered: matches-diff yes/no
ticket: drafted+approved:false yes/no (for each high-severity finding)
evidence: <the graphify/git/read results that support each check>
reason: <one line>
next: done | return-to-plan | human-review
```

Return the same facts in the workflow's structured verdict booleans. `verdict: pass` is not
sufficient unless every critical boolean is true. Pass only when the score reaches the Plan
threshold, the rubric is valid and unchanged, and critical failures are 0. A high score never
compensates for a false positive, an unresolvable citation, an inflated severity, or a review that
skipped part of the change. On failure, return the complete scorecard to Plan; do not rewrite the
findings yourself.
