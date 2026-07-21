# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit the spec, the ticket, or any file other than
your verdict. Report pass/fail with evidence and do not rewrite the spec.

Apply the approved task-specific scorecard in `runs/<run-id>/plan.md` using the shared
[`../EVAL.md`](../EVAL.md) contract. Because the product is a document, grade only what is
objective; the owner still approves whether it is the right thing to build.

## Checks

1. **Sections complete** — every required section from the plan is present and non-empty.
2. **Grounding (critical)** — resolve every reference the spec cites yourself, with
   `graphify query`/`path`/`explain` and targeted file reads. Every file, service, action, route,
   table, or existing entity must exist in the repo today. An unresolved or invented reference is a
   critical failure.
3. **Not a duplicate (critical)** — independently confirm the proposed capability is genuinely new
   (grep services, actions, derivations — not just table names), or that it names the real code it
   changes. A spec for something already built fails.
4. **Testable acceptance criteria (critical)** — each criterion names an observable outcome a
   building pipeline could assert. Reject "works well", "is fast", or any unfalsifiable wording.
5. **Bounded scope (critical)** — one slice; in-scope and out-of-scope both explicit; no epic creep.
6. **Honest open questions** — every unmade owner decision is listed under open questions, not
   answered by invention.
7. **Valid drafted ticket** — `proposed-ticket.md` exists, targets a real building `category`/`type`,
   carries the fields that pipeline's scope gate requires, and is marked `approved: false`.
8. **Constraints respected** — the spec honors `CLAUDE.md` (Neon + Drizzle services, server-first,
   Zod-validated mutations, no Convex, no client secrets).

## Verdict format

Write `runs/<run-id>/eval.md`:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
sections: complete/incomplete
grounding: all-resolve yes/no (list any that did not)
duplicate-check: genuinely-new yes/no
acceptance-criteria: all-testable yes/no
scope: bounded yes/no
open-questions: honest yes/no
ticket: drafted+approved:false yes/no
evidence: <the graphify/grep/read results that support each check>
reason: <one line>
next: done | return-to-plan | human-review
```

Return the same facts in the workflow's structured verdict booleans. `verdict: pass` is not
sufficient unless every critical boolean is true. Pass only when the score reaches the Plan
threshold, the rubric is valid and unchanged, and critical failures are 0. A high score never
compensates for an ungrounded reference, an untestable criterion, an unbounded scope, or a
duplicate. On failure, return the complete scorecard to Plan; do not rewrite the spec yourself.
