---
type: concept
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - verification
---

# Maker-verifier separation

The agent that creates a change must not be the agent that certifies it. Execute is the maker;
Eval is a fresh, read-only verifier with independent context and, where configured, a different
model. The verifier cites observed evidence and issues a verdict without suggesting repairs.

This prevents the same reasoning path from silently accepting its own assumptions. Failure
returns to Plan so the approach and rubric remain visible rather than allowing the maker to patch
until its private definition of success turns green.

Mechanical gate runners add a third kind of evidence: deterministic command output. They support
the verifier but do not replace task-specific judgment. See [[pipelines/EVAL]] and
[[vault/concepts/evaluation-and-exit-conditions]].
