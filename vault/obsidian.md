---
type: architecture
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - map
---

# Agent loop knowledge vault

`agent-loop-core` is a project-neutral template for routing work through bounded,
evidence-driven pipelines. The deterministic orchestrator validates a work item and selects a
pipeline. That pipeline runs Explore, Plan, Execute, and Eval with a different maker and verifier.
The system improves by turning observed failures into small memory entries, then selecting one
reproducible weakness at a time for an approval-gated machinery change.

Open the repository root as the Obsidian vault. This note is its home page; bookmark or pin it if
you want Obsidian to open here because personal workspace layout is intentionally not committed.
No community plugin is required.

## Start here

- Installing a copy: [[vault/operations/installing-in-a-project]]
- System shape: [[vault/architecture/system-overview]]
- Routing work: [[vault/concepts/work-items-and-routing]]
- Pipeline lifecycle: [[vault/architecture/pipeline-lifecycle]]
- Bounded improvement: [[vault/concepts/self-improvement]]
- Knowledge ownership: [[vault/architecture/knowledge-layers]]

## Repository contracts

- [[README|Public README]]
- [[agent-loop|Operating principles]]
- [[categories|Categories and routing policy]]
- [[orchestrator/orchestrator|Orchestrator contract]]
- [[pipelines/README|Pipeline registry and anatomy]]
- [[pipelines/EVAL|Evaluation contract]]
- [[memory/README|Machine-facing memory contract]]
- [[resources/README|Research resource library]]
- [[skills-library|Skills library]]
- [[STACK|Blank project stack mapping]]

These files remain at their operational paths. The vault indexes and explains them; it does not
duplicate or relocate them.

## Maps of Content

- [[vault/maps/architecture|Architecture]]
- [[vault/maps/pipelines|Pipelines]]
- [[vault/maps/operations|Operations]]
- [[vault/maps/research|Research]]
- [[vault/maps/improvements|Improvements]]

## Where knowledge belongs

- Load-bearing core decision: [[vault/decisions/README|decisions]]
- New source or investigation: [[vault/research/README|research]]
- Architectural explanation: [[vault/maps/architecture|architecture]]
- Proposed direction: [[vault/recommendations/README|recommendations]]
- Non-trivial consuming-project incident: [[vault/project/incidents/README|incidents]]
- Other project decision, research, or recommendation: [[vault/project/README|project knowledge]]
- Unresolved project question: [[vault/project/open-questions]]
- Project task state change: [[vault/project/tasks]]
- Notable shipped project change: [[vault/project/changelog]]
- Compact evidence that should influence `pipeline-improve`: [[memory/README|memory]]

Use the matching note under [[vault/templates/decision|templates]] when creating a new record.
After a material curated knowledge change, append one dated line to [[vault/log]].

## Generated state

Do not manually edit pipeline `runs/`, queue archives, `orchestrator/.heartbeat`,
`memory/run-metrics.jsonl`, `dashboard.md`, or populated `orchestrator/dispatch-log.md`. Machinery
owns those artifacts. Obsidian workspace files and project attachments are local-only as well.
