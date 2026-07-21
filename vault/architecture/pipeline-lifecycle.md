---
type: architecture
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - pipelines
---

# Pipeline lifecycle

Every pipeline uses the same lifecycle while defining evidence appropriate to its own output.
The canonical stage contract and registry live in [[pipelines/README]].

## Explore

Explore reads the task, repository, prior evidence, and relevant constraints. It writes findings
to ignored run state and does not edit tracked implementation files.

## Plan

Plan selects an approach, names the exact scope, and creates a task-specific 100-point rubric.
The rubric is fixed before implementation so success cannot be redefined after seeing the result.
Approval-gated pipelines pause here.

## Execute

Execute is the maker. It changes only the approved scope in an isolated worktree and records
commands and evidence without grading itself.

## Eval

Eval is a fresh, read-only verifier. It applies the approved rubric, reruns relevant checks, and
returns pass or fail. Failure routes back to Plan, not directly to an improvising maker. See
[[vault/concepts/maker-verifier-separation]] and
[[vault/concepts/evaluation-and-exit-conditions]].
