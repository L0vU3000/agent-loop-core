# agent-loop-core

A reusable, self-improving agent-loop: many peer pipelines organized by category,
each owning `explore → plan → execute → eval` with a separate verifier, driven by an
orchestrator that dispatches work items from an inbox. Zero npm dependencies — pure
Node built-ins.

This repo is a **template you copy into a project**, not a library you link. Pipelines
get tuned per project (that's the point), so each project owns its copy and diverges
freely. See `agent-loop.md` for the operating principles.

## What travels vs what stays

| Travels (this repo — the "core") | Stays per-project (git-ignored here) |
|---|---|
| `orchestrator/*.mjs`, `scripts/*` — the machinery | `pipelines/*/runs/` — run history |
| Pipeline scaffolds (`explore/plan/execute/eval` shapes) | `orchestrator/inbox`, `done` queues |
| `categories.md`, `agent-loop.md`, docs | `memory/run-metrics.jsonl`, `.heartbeat`, dispatch log |
| `memory/*` as **empty templates** | the accumulated entries you write into them |

## Use it in a new project

```bash
# 1. Copy the core in, one level under your repo root
cd /path/to/your-project
npx degit your-org/agent-loop-core agent-loop

# 2. Reset instance data + get a report of prose to adapt
node agent-loop/init.mjs

# 3. Run one tick (empty inbox is fine — it just heartbeats)
node agent-loop/orchestrator/tick.mjs
```

`init.mjs` wipes any leftover run/queue data to a clean slate and lists every pipeline
`.md` still using the origin project's vocabulary (Neon, Drizzle, Clerk, …) so you know
exactly which prose to rewrite for your stack. The machinery itself is project-neutral
and runs immediately.

## Layout

```
agent-loop/
├── agent-loop.md        ← entry point + operating principles (read first)
├── categories.md        ← pipeline categories + routing policy
├── init.mjs             ← adopt-into-project: reset instance data + report tuned files
├── orchestrator/        ← inbox → dispatch → tick machinery (*.mjs)
│   ├── orchestrator.md    ← the inbox + dispatch contract
│   ├── tick.mjs, dispatch.mjs, metrics.mjs, …
│   ├── inbox/  done/      ← work-item queues (empty in the template)
│   └── dispatch-log.md    ← ledger (empty in the template)
├── pipelines/           ← one dir per pipeline: pipeline.md + explore/plan/execute/eval
│   ├── README.md          ← shared pipeline anatomy
│   └── EVAL.md            ← the eval contract
├── memory/              ← decisions / errors / changelog — self-improvement substrate
└── scripts/             ← regression checks + dashboard (run scripts/check-machinery.sh)
```

## Keeping the machinery healthy

`scripts/check-machinery.sh` runs the regression suite over the orchestrator, dispatch,
eval scoring, and metrics. Run it after touching any `.mjs`. It needs Node ≥ a version
with `node:test` (Node 18+).

## Updating the core across projects

Copy-and-own, not submodule. When you fix the machinery here, re-copy the changed
`.mjs`/`scripts` files into each consuming project. If you ever run 3+ projects that all
need the same machinery fixes fast, revisit a git-subtree link — until then, copy wins.
