# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit the findings, the tickets, or any file other
than your verdict. Report pass/fail with evidence and do not add your own findings or rewrite the
maker's.

Apply the approved task-specific scorecard in `runs/<run-id>/plan.md` using the shared
[`../EVAL.md`](../EVAL.md) contract. Your job is adversarial: take each reported finding and try
to **disprove it** on the live surface. A findings list is only as valuable as it is trustworthy,
so drop anything you cannot stand up.

## Checks

1. **Findings verified (critical)** — for every reported finding, independently re-drive the
   surface: re-render the route at the stated viewport and state, locate the cited element, and
   re-observe the claimed visual or accessibility defect yourself. Use the `design-review` gstack
   skill in observe-only mode and `graphify` to confirm the element behind the surface.
2. **No false positives (critical)** — **drop** any finding you cannot reproduce on the surface or
   whose cited element does not exhibit the claimed problem. Record what you dropped and why. A
   hallucinated or unreproducible finding that survives to the owner is a critical failure of this
   pipeline.
3. **Evidence cited (critical)** — every surviving finding resolves to the surface plus a specific
   element and points at re-observable proof (a screenshot or accessibility-check result). A
   finding whose evidence cannot be re-observed fails.
4. **Severity justified (critical)** — each surviving finding's severity matches the plan's
   severity definitions; a spacing nit labeled high or taste dressed as a defect is a severity
   failure.
5. **Scope covered (critical)** — the review's declared scope (surface, states, viewports) matches
   the target the ticket named. A review that silently skipped a supported viewport or a key state
   fails.
6. **Valid drafted ticket** — for each confirmed high-severity finding, `proposed-tickets.md`
   carries a ticket targeting a real building `category`/`type` with that pipeline's required
   fields, marked `approved: false`.
7. **Read-only + advisory** — the maker edited no product source or styles and drove the browser
   observe-only; findings only propose.

## Verdict format

Write `runs/<run-id>/eval.md`:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
findings-verified: all-reproduced yes/no (list any that were not)
false-positives: dropped <count> (list each dropped finding + why)
evidence-cited: all-resolve yes/no
severity-justified: yes/no
scope-covered: matches-target yes/no
ticket: drafted+approved:false yes/no (for each high-severity finding)
evidence: <the screenshots/accessibility-checks/graphify results that support each check>
reason: <one line>
next: done | return-to-plan | human-review
```

Return the same facts in the workflow's structured verdict booleans. `verdict: pass` is not
sufficient unless every critical boolean is true. Pass only when the score reaches the Plan
threshold, the rubric is valid and unchanged, and critical failures are 0. A high score never
compensates for a false positive, an unresolvable citation, an inflated severity, or a review that
skipped part of the target. On failure, return the complete scorecard to Plan; do not rewrite the
findings yourself.
