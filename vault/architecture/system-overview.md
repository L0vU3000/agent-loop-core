---
type: architecture
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
---

# System overview

The agent loop separates deterministic control flow from model judgment. Work arrives as a
Markdown item. The orchestrator validates its category and type against pipeline frontmatter,
orders it by priority, and emits the workflow to run. It never spends a model call deciding what
ordinary code already knows.

The selected pipeline owns a four-stage lifecycle:

1. Explore gathers evidence without changing tracked files.
2. Plan chooses a bounded approach and writes the Eval rubric.
3. Execute acts as the maker in an isolated worktree.
4. Eval acts as a fresh verifier and returns pass or a route back to Plan.

The Workflow runtime executes stage agents. The Node orchestrator owns validation, routing,
claiming, bookkeeping, metrics, and heartbeat state. Their boundary is deliberate: the
orchestrator names work; it does not impersonate the agent runtime.

See [[vault/architecture/orchestrator]], [[vault/architecture/pipeline-lifecycle]], and the
canonical [[agent-loop|operating principles]].

## Safety shape

- Plan and risky actions remain human-approved.
- Maker and verifier are separate roles.
- Objective checks are run by machinery where possible.
- Attempts, agent calls, time, and no-progress conditions are bounded.
- Database-writing pipelines use development data and preserve destructive-operation gates.
- Run state and project knowledge remain outside reusable core contracts.
