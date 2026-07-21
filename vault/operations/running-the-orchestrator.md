---
type: operation
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - orchestrator
---

# Running the orchestrator

Use one scheduled tick rather than an open-ended shell loop:

```bash
node agent-loop/orchestrator/tick.mjs
```

The tick validates the pipeline registry and inbox, refreshes `dashboard.md`, and prints the
agent actions needed to execute each selected workflow. The Workflow runtime performs those
actions in isolated worktrees; the Node process does not invoke model agents itself.

Correct invalid items instead of forcing a route. After a run, follow
[[vault/operations/reviewing-and-recording-runs]]. For command details and record-gate behavior,
use the canonical [[orchestrator/orchestrator|orchestrator contract]].
