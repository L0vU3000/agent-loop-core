---
type: operation
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - improvement
---

# Promoting core improvements

Promotion is currently a manual, human-reviewed process. Start from one passing local improvement
with a focused regression check. Distill the lesson into project-neutral machinery, a generic
safety rule, or template documentation. Never copy a raw memory entry or run artifact upstream.

Before proposing the change:

1. Limit the candidate to the reusable behavior and its deterministic check.
2. Remove project names, tickets, paths, schema details, stack values, credentials, customer data,
   and project-specific pipeline tuning.
3. Exclude filled [[STACK]], `memory/`, `vault/project/`, queues, runs, metrics, heartbeat, and
   dispatch state.
4. Run `bash scripts/check-machinery.sh` and the repository's project-neutral leak scan.
5. Review the complete candidate diff against the public core baseline.
6. Ask a human to approve publication, pushing, and merging separately.

No repository script currently publishes a candidate automatically. The proposed guarded export
workflow is tracked in [[vault/recommendations/cross-project-sync]].
