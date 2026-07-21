# Stage 1 — Explore (read-only)

You are the Explore stage of `release`. Do not edit documentation, code, git state, provider state,
releases, or announcements.

Write `runs/<run-id>/explore.md` with:

1. The release name/version, owner, repository, reviewed change, head SHA, base branch, target
   environment, and current landed/deployed state.
2. Existing release notes and documentation evidence, including whether `document-release` already
   verified them before landing.
3. Existing independently verified landing, deployment, one-pass verification, and required canary
   evidence, each tied to an exact commit and environment.
4. Any missing prerequisite and the delivery pipeline or installed capability that must own it. The
   release run stops until that prerequisite returns verified evidence.
5. The planned release-record fields and whether an earlier verified record awaits final sign-off.
6. On resume: prior notes, latest Eval, release-record fingerprint, attempt count, last failure, and
   repeat count.

Refuse if the candidate is unreviewed, lacks verified notes/landing/deployment evidence, has no named
owner or environment, or asks this wrapper to publish through a capability that is not installed and
approved.
