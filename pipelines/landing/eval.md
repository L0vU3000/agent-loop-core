# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit code, git state, or remote state. Apply the
approved scorecard through [`../EVAL.md`](../EVAL.md).

Independently verify:

1. The approved repository, change ID, head SHA, base branch, merge method, and approval identity.
2. Required CI and review evidence was current at the recorded merge gate.
3. Authoritative remote state reports the change merged and supplies the expected merge record.
4. The approved revision is contained in the merge result according to the repository's merge
   method.
5. No deploy, rollback, release, force push, branch rewrite, or unrelated local edit occurred.

Write:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
rubric-sha256: <observed fingerprint>
landing-identity: <observed identity>
revision-matched: yes/no
gates-current: yes/no
remote-merged: yes/no
landing-only: yes/no
evidence: <remote queries and relevant output>
reason: <one sentence>
next: done | return-to-plan | human-review
```

Pass only at threshold with zero critical failures, an unchanged rubric and identity, all gates
true, and cited remote evidence. Return every failure to Plan; do not suggest a repair or retry the
merge.
