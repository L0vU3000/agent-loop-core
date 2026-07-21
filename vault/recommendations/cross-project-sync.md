---
type: recommendation
status: draft
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - distribution
---

# Guarded cross-project synchronization

## Status

Recommended, not implemented. The repository still uses manual reviewed copying.

## Problem

Copy-and-own lets consuming projects tune pipelines safely, but reusable machinery improvements
do not automatically flow downstream or back to the public core. Unrestricted bidirectional Git
operations could expose private instance state or overwrite local ownership.

## Recommendation

Preserve copy-and-own distribution. Do not use a Git submodule and avoid unrestricted subtree
pushes. Add a project-owned manifest that records the installed core source and stable version or
revision without requiring a source file to contain its own commit hash.

Synchronize only explicit core-owned allowlisted paths. Default to a dry-run preview. Treat
project-tuned pipeline Markdown as review-only. Reject filled [[STACK]], `memory/`,
`vault/project/`, runs, queues, metrics, heartbeat, dispatch state, and other project-owned files.

For upstream promotion, export selected changes as a sanitized reviewable patch. Run built-in
secret and path checks plus a configurable project-vocabulary leak scan. Distill local evidence
into neutral rules and regression checks; do not export raw memory. Require separate human review
before any push or merge.

## Alternatives

- Git submodule: conflicts with intentional local tuning.
- Unrestricted subtree: bidirectional pushes have too broad an exposure surface.
- Package publication: does not fit Markdown contracts and copyable workflow definitions.
- Manual recopying forever: safe at small scale but error-prone across many consumers.

## Risks

An incorrect allowlist could widen ownership silently; a weak leak scan could miss private
vocabulary; and a sync could erase project tuning. The design therefore needs deterministic
ownership fixtures, explicit opt-in, clear recovery, and no automatic publication.

## Implementation outline

1. Define core-owned, review-only, and protected paths.
2. Record an externally supplied immutable release tag or source checkout revision.
3. Implement local-checkout import with dry-run default and explicit apply.
4. Implement selected-file patch export with path rejection and leak scanning.
5. Add red-to-green regression fixtures and wire them into machinery validation.
6. Keep all publication and merge operations outside the scripts.
