---
type: architecture
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - knowledge
---

# Knowledge layers

The repository keeps three layers distinct because they have different readers and ownership.

## Operational contracts

Pipeline stage documents, `pipeline.md`, [[orchestrator/orchestrator]], [[STACK]],
[[pipelines/EVAL]], registries, and safety guidance tell machinery and agents how to behave.
Their paths are stable and they remain GitHub-readable Markdown.

## Machine-facing memory

[[memory/README|memory/]] is concise evidence consumed by `pipeline-improve`: errors, decisions,
machinery changes, and generated metrics. A short entry may link to a richer vault note, but the
vault does not replace this ranking substrate.

## Human-curated knowledge

`vault/` explains architecture, research, recommendations, decisions, operations, and open
questions. Core-owned sections may evolve with the template. [[vault/project/README|vault/project/]]
belongs to the consuming project and may contain private context.

## Ownership boundary

Core-owned and potentially synchronizable paths are `vault/maps/`, `vault/architecture/`,
`vault/concepts/`, `vault/operations/`, `vault/templates/`, and general core decisions, research,
and recommendations.

Project-owned paths are `vault/project/`, filled [[STACK]], `memory/`, run history, queues,
metrics, dispatch state, and project-tuned pipeline prose. Future synchronization must not
overwrite or automatically promote those paths.
