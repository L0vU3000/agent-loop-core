---
type: architecture
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - distribution
---

# Distribution model

`agent-loop-core` is copied into a project with `degit`; it is not linked as a package or Git
submodule. The consuming project owns the copy and may tune its pipeline prompts and fill
[[STACK]] without coupling ordinary work to an upstream repository.

This copy-and-own model favors local fit and simple installation. Its cost is that reusable core
changes need an explicit, guarded transfer. The current repository documents manual review; it
does not yet implement automatic synchronization. See
[[vault/recommendations/cross-project-sync]] for the proposed manifest, ownership allowlist,
dry-run, sanitized-patch, leak-scan, and human-approval workflow.

Project-owned knowledge and runtime state never become upstream source merely because they live
under a copied agent-loop directory. See [[vault/architecture/knowledge-layers]].
