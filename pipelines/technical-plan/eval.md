# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit the technical plan or any file other than your
verdict. Report pass/fail with evidence and do not rewrite the plan.

Apply the approved task-specific scorecard in `runs/<run-id>/plan.md` using the shared
[`../EVAL.md`](../EVAL.md) contract. Because the product is an engineering plan, grade only what is
objective; the owner still approves whether it is the right architecture to commit to.

## Checks

1. **Sections complete** — every required section from the plan is present and non-empty:
   architecture, file-by-file change list, layered touchpoints, sequence, rollback, risks, open
   questions.
2. **Grounding (critical)** — resolve every reference the plan cites yourself, with
   `graphify query`/`path`/`explain` and targeted file reads. Every `modify` path, service, action,
   route, table, and column must exist in the repo today; every `create` path must sit beside the
   real sibling the plan names. An unresolved or invented reference is a critical failure.
3. **Layer completeness (critical)** — walk the data → service → action → UI → tests →
   migration chain. Confirm nothing required to ship the slice is missing: a new mutation carries
   its Zod validation, service query, action, UI wiring, and tests; a schema change carries a
   migration step. A gap in the chain is a critical failure.
4. **Buildable sequencing (critical)** — read the implementation sequence in order and confirm each
   step depends only on steps before it, with no forward references. A builder must be able to
   follow it top to bottom without back-tracking.
5. **Bounded scope (critical)** — one slice; in-scope and out-of-scope both explicit; no epic
   creep, and no widening past the approved spec.
6. **Constraints respected** — the plan honors `CLAUDE.md` (Neon + Drizzle services, server-first,
   Zod-validated mutations, no Convex, no client secrets).
7. **Honest open questions** — every unmade owner decision is listed under open questions, not
   answered by invention.

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
layers: complete yes/no (name any missing layer)
sequence: buildable yes/no
scope: bounded yes/no
constraints: respected yes/no
open-questions: honest yes/no
evidence: <the graphify/grep/read results that support each check>
reason: <one line>
next: done | return-to-plan | human-review
```

Return the same facts in the workflow's structured verdict booleans. `verdict: pass` is not
sufficient unless every critical boolean is true. Pass only when the score reaches the Plan
threshold, the rubric is valid and unchanged, and critical failures are 0. A high score never
compensates for an ungrounded reference, a missing layer, an unbuildable sequence, or an unbounded
scope. On failure, return the complete scorecard to Plan; do not rewrite the plan yourself.
