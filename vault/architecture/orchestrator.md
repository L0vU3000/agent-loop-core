---
type: architecture
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-control-plane
  - orchestrator
---

# Orchestrator architecture

The orchestrator is a zero-dependency Node control plane. Its canonical behavior is defined in
[[orchestrator/orchestrator]]. Pipeline frontmatter is the routing source of truth; human-readable
tables are checked projections rather than independent registries.

On a tick it validates inbox items, rejects unknown or mismatched routes, claims eligible work,
and prints the pipeline workflow for the agent runtime. Recording then moves the item to the
appropriate archive and updates the ledger. A claimed pass on code-changing work passes through
objective record gates that can downgrade a result but never upgrade one.

The heartbeat is one scheduled pass, not an unbounded `while` loop. The agent executes the
workflow named by the dispatcher and records the result against the live tree. This preserves a
clear seam between deterministic routing and probabilistic work.

Related notes: [[vault/concepts/work-items-and-routing]],
[[vault/operations/running-the-orchestrator]], and [[vault/operations/creating-work-items]].
