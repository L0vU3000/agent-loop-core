---
name: agent-control-plane-transaction
description: Run a bounded code-changing request through the repository's agent-control-plane workflow.
---

# Agent control-plane transaction

Use this skill for bounded code-changing work in a repository that contains `agent-control-plane/`.
Read `AGENTS.md` when present, plus `agent-control-plane/STACK.md`,
`agent-control-plane/categories.md`, and `agent-control-plane/orchestrator/orchestrator.md` before
acting. `AGENTS.md` and `STACK.md` define the concrete project commands and safety boundaries; do not
invent missing values.

1. Choose the exact category and type. If needed, narrow candidates without dispatching:
   `node agent-control-plane/orchestrator/dispatch.mjs --candidates <category> --json`.
2. Draft the bounded item outside the live inbox at
   `.context/inbox-drafts/YYYY-MM-DD-<slug>.md`, including a concrete, independently verifiable
   `"Done" = ...` condition and relevant scope constraints.
3. Check the draft with
   `node agent-control-plane/orchestrator/check-work-item.mjs <draft-path> --json`, fixing it until it
   passes.
4. Show the checked draft and obtain the user's start approval. Never treat this skill, a Cursor rule,
   or the agent's own judgment as approval.
5. After approval, move the item into `agent-control-plane/orchestrator/inbox/`, run
   `node agent-control-plane/orchestrator/tick.mjs`, and follow its `AGENT ACTIONS` through the selected
   pipeline.
6. Record the objective result from the live workspace with
   `node agent-control-plane/orchestrator/dispatch.mjs --record <inbox-file> <pass|fail> --summary "<one line>"`.

Surface every additional approval required by `AGENTS.md`, `STACK.md`, or the selected pipeline,
including plan, migration, merge, deploy, rollback, and release gates. Do not self-approve gated work.
