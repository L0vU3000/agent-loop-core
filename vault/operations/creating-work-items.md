---
type: operation
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - routing
---

# Creating work items

Create one Markdown file in `agent-loop/orchestrator/inbox/`:

```markdown
---
category: building
type: bug
priority: normal
created: 2026-07-21
---

Fix the reproducible behavior described here.

Done: the behavior is covered by a regression check and all relevant gates pass.
```

Choose category and type from [[categories]] and [[pipelines/README]]. State observable completion,
constraints, and risky approvals. Never include credentials or customer data. Validate a drafted
item with `node agent-loop/orchestrator/check-work-item.mjs <path>` before dispatch.

See [[vault/concepts/work-items-and-routing]] for why the router rejects ambiguity.
