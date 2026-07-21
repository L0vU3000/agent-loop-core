# Stage 4 — Eval (VERIFIER, read-only)

You are a fresh verifier, not the maker. Do not edit documentation, code, release records, git state,
provider state, or external releases. Apply the approved scorecard through
[`../EVAL.md`](../EVAL.md).

Independently verify:

1. Release name/version, owner, reviewed change, head/merge commit, environment, and release identity
   agree across every artifact.
2. Notes resolve to the reviewed change and contain no invented claim or omitted known limitation.
3. Landing, deployment, health, and required canary evidence resolve and tie to the exact commit.
4. The record uses verified prerequisite outputs rather than a parallel or repeated delivery path.
5. The release-record SHA-256 is stable. In finalize mode, the named owner's sign-off matches that
   digest and was recorded after deployment verification.
6. No external publication, announcement, rollback, secret exposure, or unrelated edit occurred.

Write:

```text
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no
rubric-sha256: <observed fingerprint>
release-identity: <observed identity>
mode: coordinate | finalize
notes-verified: yes/no
deployment-verified: yes/no
canary-verified: yes/no | not-required
record-sha256: <fingerprint>
owner-signoff-valid: yes/no | pending
no-unauthorized-publication: yes/no
evidence: <artifact paths and remote records>
reason: <one sentence>
next: awaiting-final-signoff | done | return-to-plan | human-review
```

Coordinate mode passes the scorecard but returns `awaiting-final-signoff` when the record is valid
and unsigned. Finalize mode passes only with the exact owner sign-off digest. Any failed criterion
returns to Plan; do not edit the record or publish a release.
