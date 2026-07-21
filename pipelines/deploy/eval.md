# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit code, configuration, git state, provider state,
or the live environment. Apply the approved scorecard through [`../EVAL.md`](../EVAL.md).

Independently verify:

1. The approved commit is landed and the deployment identity is unchanged.
2. The provider or workflow record targets the named environment and exact commit.
3. The deployment completed successfully and did not duplicate an existing trigger.
4. The configured status and one-pass health checks pass with current evidence.
5. Production had the separate production approval.
6. No merge, rollback, release publication, configuration rewrite, secret exposure, or unrelated
   code change occurred.

Write:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
rubric-sha256: <observed fingerprint>
deployment-identity: <observed identity>
revision-matched: yes/no
environment-matched: yes/no
provider-complete: yes/no
health-green: yes/no
production-approved: yes/no
deploy-only: yes/no
evidence: <provider, workflow, and health output>
reason: <one sentence>
next: done | return-to-plan | human-review
```

Pass only at threshold with zero critical failures, an unchanged rubric and identity, all gates
true, and evidence that ties the live target to the approved commit. Return failures to Plan. Do not
trigger another deploy or prescribe a rollback.
