---
type: concept
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - improvement
---

# Bounded self-improvement

Self-improvement is evidence-driven and bounded:

1. Pipeline Eval produces run evidence.
2. Failures become concise entries in [[memory/errors]].
3. Load-bearing choices go into [[memory/decisions]].
4. Machinery changes go into [[memory/changelog]].
5. [[pipelines/pipeline-improve/pipeline|pipeline-improve]] reads memory and recent run evidence.
6. It selects exactly one reproducible weakness.
7. Plan defines one improvement and a red-to-green regression check.
8. The workflow pauses for human approval.
9. Execute implements only the approved improvement.
10. A fresh verifier and independent gate runner check it.
11. Failure returns to Plan.
12. A passing reusable improvement may become a human-reviewed upstream core candidate.

“Self-improving” does not mean unbounded self-editing, removing checks to obtain a pass,
automatically publishing project memory, letting the maker grade itself, or automatically
overwriting consuming-project customizations.

Machine memory stays short enough to rank. Detailed causes, research, or architectural context
can live in the curated vault and be linked from memory. Upstream candidates must distill local
evidence into a project-neutral rule, regression check, or machinery change; raw project history
does not travel. See [[vault/concepts/memory-and-evidence]] and
[[vault/operations/promoting-core-improvements]].
