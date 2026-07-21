---
name: release
category: delivery
type: release
---

# Pipeline: release

> Consumes verified documentation, landing, deployment, and canary evidence from the existing
> capabilities, assembles one release record, and stops for final owner sign-off.

## Goal

Produce one evidence-backed release record that ties approved notes to an exact landed commit and a
verified named deployment, then record the owner's final post-deploy sign-off.

## Scope gate

Explore accepts only a named release candidate with reviewed change evidence, a version or release
identity, target environment, owner, verified notes, and verified landing/deployment records. It
refuses and routes:

- unreviewed product work to `code-review` or the relevant building pipeline;
- missing pre-merge documentation to the installed `document-release` capability;
- missing landing evidence to `landing`, missing deployment evidence to `deploy`, and missing
  required extended observation to `canary`;
- an external announcement, package publication, or GitHub release without a separately installed
  and approved publication capability.

## Exit condition

One release passes only when every check is true:

1. The release identity, approved notes, pull request, landed commit, deployment record, and target
   environment agree.
2. Required notes were produced or verified through `document-release`; landing and deployment were
   independently verified by their delivery pipelines; no domain logic was duplicated.
3. The deployment has a passing one-pass verification and any required canary evidence.
4. The release record cites resolving evidence and contains no invented claim, secret, or unverified
   success statement.
5. After deployment verification, the named owner explicitly signs off the exact release-record
   fingerprint. Without that sign-off the result remains `awaiting-final-signoff`.
6. No external release publication or announcement occurred unless a separate publication
   capability and approval were present; this authored wrapper provides neither.

## Verification technique

The verifier performs release attestation: independently cross-check the notes against the reviewed
change, the merge record against the approved revision, and the provider/health record against the
landed commit. It hashes the exact release record so the owner's final sign-off cannot silently apply
to changed notes or deployment evidence.

## Stages

`explore → plan → execute → eval`. Execute is the maker. Eval is a fresh, different-model verifier.
Every Eval failure writes evidence and returns to Plan before another Execute attempt. A first pass
may end at `awaiting-final-signoff`; a signed resume re-enters all four stages and re-verifies the
unchanged release record before completion.

## Guardrails

- **Capability boundary:** consume verified outputs from `document-release`, `landing`, `deploy`, and
  `canary`. Release does not perform or re-authorize their actions and does not reproduce their
  internal commands.
- **Training mode:** locked on while unproven. Coordination resumes with
  `--resume=<run-id> --approved-plan --approve-release`. Finalization requires
  `--final-signoff=<release-record-sha256>` from the named owner.
- **Approval identity:** release name/version, change, head/merge commit, target environment,
  capability sequence, rubric fingerprint, and threshold are immutable after approval.
- **Isolation:** the release record lives in ignored run state. This wrapper does not change product,
  git, provider, or publication state.
- **Bounds:** at most 3 attempts, 8 agent calls per invocation, and a declared 55,000-token ceiling.
- **No progress:** stop after the same verifier failure repeats twice or evidence cannot tie notes,
  commit, and deployment together.
- **Memory:** append reusable release failures to `agent-loop/memory/errors.md`.
- **Authoring safety:** structural checks never merge, deploy, monitor production, roll back,
  publish, or announce.

## Status and trigger

Authored in locked training mode. The first real proof waits for a genuine reviewed release
candidate. This wrapper does not publish an external release; adding that action requires a proven
publication capability and a new explicit gate.
