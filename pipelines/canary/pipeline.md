---
name: canary
category: delivery
type: canary
---

# Pipeline: canary

> Observes defined post-deploy health signals with the installed `canary` capability. It escalates
> threshold failures and can enter a separately approved rollback path, but never changes production
> from an observation approval alone.

## Goal

Determine whether one identified deployment remains healthy for the approved observation window,
then either record a healthy verdict or escalate persistent threshold failures with evidence.

## Scope gate

Explore accepts only a named deployment, environment, URL or status target, observation window, page
or signal set, baseline, and threshold contract. It refuses and routes:

- a deployment request to `deploy`;
- an unlanded change to `landing`;
- undefined health signals or missing deployment identity back to the owner;
- performance tuning to `performance-burndown`;
- application fixes discovered during monitoring to the relevant building pipeline.

Observation is read-only. A rollback is a separate execution mode that requires a named approved
rollback mechanism, an exact deployment identity, and an explicit rollback approval.

## Exit condition

Observation passes only when every check is true:

1. Every planned signal was collected at the planned cadence for the bounded window.
2. Evidence is tied to the approved deployment and environment.
3. Persistent failures use the Plan's thresholds and consecutive-check rule; transient failures are
   not promoted to incidents.
4. The final status is `HEALTHY`, or `DEGRADED`/`BROKEN` with an owner-visible escalation record.
5. No rollback or other external write occurred without the separate rollback approval.

An approved rollback attempt passes only when the installed rollback capability records the exact
target rollback and a fresh observation confirms the restored deployment's planned health signals.

## Verification technique

This pipeline uses repeated differential observation, matching the installed `canary` capability:
compare current pages and signals with the baseline, require a failure to persist across at least two
checks, and preserve screenshots, console output, performance data, status responses, and timestamps.
The verifier independently re-reads the evidence and rechecks the final live state once.

## Stages

`explore → plan → execute → eval`. Execute is the maker. Eval is a fresh, different-model verifier.
Every Eval failure writes evidence and returns to Plan before another Execute attempt.

## Guardrails

- **Capability boundary:** use the installed `canary` skill for page discovery, baseline comparison,
  cadence, evidence, and report format. Use an installed `land-and-deploy` rollback path only after
  explicit rollback approval. Do not duplicate either workflow.
- **Training mode:** locked on while unproven. Observation resumes with
  `--resume=<run-id> --approved-plan`. Rollback also requires `--approve-rollback`.
- **Read-only default:** observation never edits product code, provider state, git state, baselines,
  or deployment configuration. Baseline promotion requires a separate owner action.
- **Isolation:** no worktree is needed for observation. Any approved rollback that changes git state
  must use an isolated worktree.
- **Bounds:** at most 3 attempts, 7 agent calls per invocation, a 1–30 minute observation window,
  and a declared 45,000-token ceiling.
- **No progress:** stop after the same evidence failure repeats twice or signals cannot be tied to the
  approved deployment.
- **Memory:** append reusable canary or rollback failures to `agent-loop/memory/errors.md`.
- **Authoring safety:** structural checks never browse production, deploy, roll back, merge, or
  publish.

## Status and trigger

Authored in locked training mode. The first real proof waits for a genuine deployment with a defined
baseline and health contract.
