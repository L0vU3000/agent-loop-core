---
type: concept
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - evaluation
---

# Evaluation and exit conditions

An exit condition describes observable completion, not effort. Before Execute, Plan translates
the task into a 100-point scorecard whose weights total 100, whose threshold is 80–100, and whose
critical checks fail closed. Eval applies the unchanged rubric to commands, artifacts, and direct
inspection.

A green test suite is necessary only when the task makes it relevant; it is never sufficient by
itself. Each pipeline chooses evidence matching its output, such as reproduced findings,
repeatable browser flows, coverage movement, provider records, or a controlled red-to-green
fixture. Global safety and regression gates remain critical.

See the canonical [[pipelines/EVAL|Eval contract]], [[pipelines/README|pipeline anatomy]], and
[[vault/concepts/maker-verifier-separation]].
