---
type: architecture
status: active
created: 2026-07-21
updated: 2026-07-30
tags:
  - agent-loop
  - distribution
---

# Distribution model

`agent-loop-core` now has two distribution models with different ownership boundaries.

## Supported package-based transaction runtime

The supported runtime is installed as a package under a dedicated tools prefix and invoked through
the `agent-loop` CLI. It operates on another Git repository; it is not installed into that target's
dependency tree and does not copy the broader pipeline template into the target.

The package is private and not currently published to npm. Build a tarball with `npm pack --json`
from a trusted core checkout, then install that exact artifact. The package contains the CLI,
productized runtime modules, and configuration example. Upgrades replace the installed tool while
target configuration and external transaction state remain independently owned.

The target owns only `.agent-loop/config.json` and its ordinary source history. Mutable claims,
evidence, transaction logs, and maker/verifier worktrees use a caller-selected state root outside
the target. Git still records linked-worktree administration in its common directory, but runtime
worktree contents and evidence do not live in the target checkout.

See [[vault/operations/installing-in-a-project]] and
[[vault/operations/running-productized-transaction]] for the operational contract.

## Legacy copy-owned template

The `degit` path is the legacy copy-owned template. It copies the full orchestrator, pipeline
scaffolds, memory templates, and vault into a consuming project. The consuming project owns that
copy, may tune its prompts, and fills [[STACK]] without coupling ordinary work to this upstream
repository.

This model remains useful for existing projects that intentionally want the broad template, but it
is not the supported installation path for the productized external transaction runtime. Running
`init.mjs` resets copied instance state, so it must not be used as a package-runtime upgrade.

Copy ownership favors local fit and simple adoption. Its cost is that reusable core changes need an
explicit, guarded transfer. The current repository documents manual review; it does not implement
automatic synchronization. See [[vault/recommendations/cross-project-sync]] for the proposed
manifest, ownership allowlist, dry-run, sanitized-patch, leak-scan, and human-approval workflow.

Project-owned knowledge and runtime state never become upstream source merely because they live
under a copied agent-loop directory. See [[vault/architecture/knowledge-layers]].
