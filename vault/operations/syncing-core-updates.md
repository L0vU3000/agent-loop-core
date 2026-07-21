---
type: operation
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - distribution
---

# Syncing core updates

Status: no automated synchronization command exists yet.

The safe current process is to compare a trusted core revision with the consuming copy, inspect
each machinery change, and copy only intentionally selected core-owned files. Never replace
filled [[STACK]], `memory/`, `vault/project/`, run history, queues, metrics, dispatch state, or
project-tuned pipeline Markdown. Run initialization only when its state-reset behavior is intended.

Always preview the full diff and keep the consuming project in version control so recovery is an
ordinary revert. Pipeline prose needs explicit review because it is designed to diverge locally.

See [[vault/recommendations/cross-project-sync]] for the unimplemented guarded workflow and
[[vault/architecture/knowledge-layers]] for ownership.
