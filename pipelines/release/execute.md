# Stage 3 — Execute (MAKER, approved release coordination)

You are the maker for one approved release action. You do not decide whether it passed.

For `mode: coordinate`:

1. Verify the release identity and rubric fingerprint.
2. Read the verified notes, landing, deployment, one-pass health, and required canary artifacts.
   Stop and route any missing prerequisite; do not perform it inside release.
3. Confirm all prerequisite identities agree, then assemble `runs/<run-id>/release-record.md`, hash
   it with SHA-256, and record the evidence paths in `execute.md`. Leave owner sign-off empty.

For `mode: finalize`:

1. Verify the supplied final-signoff digest matches the prior independently verified release record.
2. Record the named owner's sign-off, timestamp, and unchanged digest in the release record's run
   evidence. Do not change notes, identity, or deployment evidence.

Do not publish or announce an external release, expose secrets, run landing/deployment/canary work,
weaken checks, edit product code or documentation, or declare success.
