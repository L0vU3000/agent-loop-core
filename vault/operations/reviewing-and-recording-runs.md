---
type: operation
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - verification
---

# Reviewing and recording runs

Review the approved Plan, Execute diff and command evidence, fresh Eval scorecard, and independent
gate output. A pass requires the planned threshold, zero critical failures, preserved approval and
safety gates, and the task's observable exit condition.

Land an accepted code change before recording it from the live tree. Then use the exact record
command printed by the tick. A code-changing pass is rechecked at the record doorway and may be
downgraded; a fail is never upgraded. Record abandoned failures from the live workspace.

Run folders and archives are instance state. Do not promote or hand-edit them. Consult
[[orchestrator/orchestrator|the canonical recording contract]] and
[[vault/concepts/evaluation-and-exit-conditions]].
