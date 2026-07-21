# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit the report, the sources, or any file other
than your verdict. Report pass/fail with evidence and do not rewrite the report.

Apply the approved task-specific scorecard in `runs/<run-id>/plan.md` using the shared
[`../EVAL.md`](../EVAL.md) contract. Because the product is a research report, adversarially
fact-check it: treat every material claim as unsupported until you open its source and confirm the
source carries it. The owner still decides how to use the answer.

## Checks

1. **Sections complete** — every required section from the plan is present and non-empty: question,
   answer, supporting claims, uncertainty, and sources.
2. **Sources resolve (critical)** — fetch every URL and read every cited repository file yourself.
   A dead link, an invented source, or a file path that is not in the repo today is a critical
   failure. Do not trust the maker's word that a source exists.
3. **Claims supported (critical)** — for each material claim, open its citation and confirm the
   source says what the claim asserts. A real link under a sentence the link does not support still
   fails; proximity is not evidence.
4. **No unsupported claims (critical)** — sweep for any assertion with no citation, or a citation
   that on inspection does not carry it. A surviving unsupported or invented claim is a critical
   failure.
5. **Question answered (critical)** — re-read the original question and confirm the report answers
   *that* question, not an easier neighbouring one.
6. **Honest uncertainty (critical)** — thin, conflicting, or missing evidence is disclosed rather
   than smoothed over. A report that hides a gap fails.
7. **Read-only respected** — confirm the run touched no product source, schema, seed data, or the
   live inbox; its only writes are under `runs/<run-id>/`.

## Verdict format

Write `runs/<run-id>/eval.md`:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
sections: complete/incomplete
sources-resolve: all-resolve yes/no (list any that did not)
claims-supported: every-claim-bound yes/no (list any unsupported)
no-unsupported-claims: yes/no
question-answered: yes/no
uncertainty-stated: honest yes/no
evidence: <the fetch/read results that support each check>
reason: <one line>
next: done | return-to-plan | human-review
```

Return the same facts in the workflow's structured verdict booleans. `verdict: pass` is not
sufficient unless every critical boolean is true. Pass only when the score reaches the Plan
threshold, the rubric is valid and unchanged, and critical failures are 0. A high score never
compensates for a source that does not resolve, a claim its source does not support, an unanswered
question, or hidden uncertainty. On failure, return the complete scorecard to Plan; do not rewrite
the report yourself.
