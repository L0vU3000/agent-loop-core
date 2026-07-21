---
name: landing
category: delivery
type: landing
---

# Pipeline: landing

> Verifies one reviewed change and lands that exact revision after explicit approval. It reuses the
> installed `land-and-deploy` readiness and merge capability, then stops before deployment work.

## Goal

Land one reviewed change into its named base branch without changing the approved head revision,
skipping required checks, or starting a deployment.

## Scope gate

Explore accepts only an open, reviewed pull request or equivalent change with an exact head commit,
target branch, review evidence, and repository identity. It refuses and routes:

- unreviewed or still-changing work to `code-review` or the relevant building pipeline;
- a request to prepare, commit, push, or open the change to the installed `ship` capability;
- a request to deploy or monitor the change to `deploy` or `canary`;
- a request with failing required checks, unresolved conflicts, stale approval, or no authoritative
  remote state back to the owner.

## Exit condition

One landing passes only when every check is true:

1. The landed remote commit is the exact approved head commit or the repository's documented merge
   result for that head.
2. Required CI and review gates were green and current immediately before the merge action.
3. The base branch and merge method match the approved Plan.
4. The remote reports the change as merged, with merge commit, actor, and timestamp captured.
5. No deploy, rollback, release publication, force push, branch rewrite, or unrelated edit occurred.

## Verification technique

The verifier re-reads authoritative remote state after the maker finishes. It compares the approved
head and base with the merged record, confirms the required checks and reviews used at the gate, and
inspects local and remote evidence for any action outside landing scope. A successful command exit is
not enough; remote merge state is the deciding evidence.

## Stages

`explore → plan → execute → eval`. Execute is the maker. Eval is a fresh, different-model verifier.
Every Eval failure writes evidence and returns to Plan before another Execute attempt.

## Guardrails

- **Capability boundary:** use the installed `land-and-deploy` skill's platform detection,
  readiness, merge queue, merge, and authoritative post-failure state checks. Stop before its deploy
  strategy step. Do not copy those commands into this pipeline.
- **Training mode:** locked on while unproven. Every run stops after Plan and resumes only with
  `--resume=<run-id> --approved-plan --approve-merge`.
- **Approval identity:** approval applies only to the Plan's repository, pull request, head SHA,
  base branch, merge method, rubric fingerprint, and threshold. Drift cancels approval.
- **Isolation:** use an isolated worktree for any local git state. The merge is the only permitted
  external write.
- **Bounds:** at most 3 attempts, 7 agent calls per invocation, and a declared 35,000-token ceiling.
- **No progress:** stop after the same verifier failure repeats twice.
- **Memory:** append reusable landing failures to `agent-loop/memory/errors.md`.
- **Authoring safety:** structural checks never merge, push, deploy, roll back, or publish.

## Status and trigger

Authored in locked training mode. Pass a delivery inbox ticket or resume a named run after the owner
approves the exact landing Plan. The first real proof waits for genuine reviewed work.
