---
type: operation
status: active
created: 2026-07-21
updated: 2026-07-21
tags:
  - agent-loop
  - installation
---

# Installing in a project

From the consuming repository root:

```bash
npx degit L0vU3000/agent-loop-core agent-loop
node agent-loop/init.mjs
```

`init.mjs` clears copied instance state, preserves directory skeletons, and reports blank roles in
`agent-loop/STACK.md`. Fill the middle column of [[STACK]] with the consuming project's concrete
database, data layer, auth, services, commands, and safety boundaries. Do not put credentials in
the mapping.

Run `node agent-loop/orchestrator/tick.mjs` once; an empty inbox should heartbeat cleanly. Then
open the copied `agent-loop` folder as an Obsidian vault, visit [[vault/obsidian]], and keep
project-specific knowledge under [[vault/project/README|vault/project/]].

The copy is independently owned. Read [[vault/architecture/distribution-model]] before carrying
changes between projects.
