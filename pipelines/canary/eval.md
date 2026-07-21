# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit code, reports, baselines, git state, provider
state, or the live environment. Apply the approved scorecard through [`../EVAL.md`](../EVAL.md).

Independently verify:

1. Evidence belongs to the approved deployment, environment, pages/signals, and time window.
2. Every planned observation ran at the planned cadence or has a cited collection failure.
3. Differential thresholds and the consecutive-check rule were applied exactly.
4. Screenshots, console output, performance numbers, status responses, and timestamps resolve.
5. Observation mode made no external write. Rollback mode had explicit approval, targeted the exact
   prior revision, and includes fresh post-rollback health evidence.

Write:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
rubric-sha256: <observed fingerprint>
canary-identity: <observed identity>
mode: observe | rollback
signal-coverage: complete | INCOMPLETE
thresholds-followed: yes/no
classification: HEALTHY | DEGRADED | BROKEN
escalation-recorded: yes/no
write-scope-valid: yes/no
rollback-verified: yes/no | not-requested
evidence: <artifact paths and final read-only check>
reason: <one sentence>
next: done | return-to-plan | human-review
```

Pass only at threshold with zero critical failures, an unchanged rubric and identity, exact
threshold use, complete evidence or an honest escalation, and valid write scope. Return failures to
Plan; do not recommend a code fix or perform a rollback.
