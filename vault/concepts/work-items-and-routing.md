---
type: concept
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - routing
---

# Work items and routing

A work item is one Markdown file in `orchestrator/inbox/` with category, type, priority, created
date, and a concrete definition of done. Category applies broad safety policy; type selects one
registered pipeline. The two must agree with pipeline frontmatter.

The dispatcher validates rather than guesses. Unknown types, mismatched categories, and missing
requirements are returned for correction. Valid items are ordered high, normal, then low and are
claimed before execution to prevent duplicate dispatch.

See [[vault/operations/creating-work-items]], [[categories]], and
[[orchestrator/orchestrator|the canonical inbox contract]].
