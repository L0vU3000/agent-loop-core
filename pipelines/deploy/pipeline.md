---
name: deploy
category: delivery
type: deploy
---

# Pipeline: deploy

> Deploys one already-landed commit to one named environment after explicit approval. It delegates
> platform detection, deployment, waiting, and one-pass health verification to the installed
> `setup-deploy` and `land-and-deploy` capabilities.

## Goal

Deploy one identified landed commit to the approved environment and prove that environment is
serving that revision without performing a merge, rollback, or release publication.

## Scope gate

Explore accepts only a commit already reachable from the named base branch, a named environment,
and a persisted or fully evidenced deployment configuration. It refuses and routes:

- an unlanded change to `landing`;
- missing or ambiguous platform, target, status, or health configuration to `setup-deploy`;
- extended post-deploy monitoring to `canary`;
- release notes, owner sign-off, or release coordination to `release`;
- a schema or data change without verified migration evidence back to its building pipeline.

## Exit condition

One deployment passes only when every check is true:

1. The approved landed commit and named environment match the deployed provider record.
2. The approved deployment capability reports completion without targeting any other environment.
3. The configured status and one-pass health checks pass with timestamped evidence.
4. For production, the separate production approval was present and bound to the same identity.
5. No merge, rollback, release publication, configuration rewrite, or unrelated code change occurred.

## Verification technique

The verifier matches three independent facts: the landed commit in git, the provider or workflow
deployment record, and the target environment's configured health evidence. HTTP availability alone
cannot prove the approved revision was deployed, and a provider success alone cannot prove the
application is healthy, so both are required.

## Stages

`explore → plan → execute → eval`. Execute is the maker. Eval is a fresh, different-model verifier.
Every Eval failure writes evidence and returns to Plan before another Execute attempt.

## Guardrails

- **Capability boundary:** use `setup-deploy` configuration and the installed `land-and-deploy`
  deploy/wait/one-pass verification portion. Do not duplicate provider commands.
- **Training mode:** locked on while unproven. Resume only with
  `--resume=<run-id> --approved-plan --approve-deploy`; production also requires
  `--approve-production`.
- **Approval identity:** repository, landed commit, environment, deployment target, rubric
  fingerprint, and threshold are immutable after approval.
- **Isolation:** any local git or configuration state uses an isolated worktree. Deployment is the
  only permitted external write.
- **Bounds:** at most 3 attempts, 7 agent calls per invocation, and a declared 40,000-token ceiling.
- **No progress:** stop after the same verifier failure repeats twice or provider state cannot be
  tied to the approved commit.
- **Memory:** append reusable deployment failures to `agent-loop/memory/errors.md`.
- **Authoring safety:** structural checks never deploy, merge, roll back, publish, or run live health
  checks.

## Status and trigger

Authored in locked training mode. The first real proof waits for a genuine landed commit and named
non-production environment before any production use.
