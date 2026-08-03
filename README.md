# agent-loop-core

A reusable, self-improving agent loop with two deliberately separate operating surfaces:

1. the **supported package-based transaction runtime**, which installs as the `agent-loop` CLI and
   runs one bounded bug-fix transaction against an external Git repository; and
2. the **legacy copy-owned template**, which supplies the broader peer-pipeline/orchestrator system
   that consuming projects can copy and tune.

The installed runtime has zero npm dependencies and uses Node built-ins. The legacy template keeps
its existing `explore → plan → execute → eval` pipelines and separate verifier. See
`agent-loop.md` for those operating principles.

The package runtime is the supported path for new external repair transactions. The `degit` path is
legacy and remains available for projects that intentionally want to own and diverge from a full
copy of the template.

## Legacy template: what travels vs what stays

| Travels (this repo — the "core") | Stays per-project (git-ignored here) |
|---|---|
| `orchestrator/*.mjs`, `scripts/*` — the machinery | `pipelines/*/runs/` — run history |
| Pipeline scaffolds (`explore/plan/execute/eval` shapes) | `orchestrator/inbox`, `done` queues |
| `categories.md`, `agent-loop.md`, docs | `memory/run-metrics.jsonl`, `.heartbeat`, dispatch log |
| `memory/*` as **empty templates** | the accumulated entries you write into them |

## Install the supported transaction runtime

The package is not currently published to npm. Build a local tarball from this repository, then
install it under a dedicated tools prefix outside the target repository:

```bash
cd /path/to/agent-loop-core
npm pack --json
npm install --prefix /absolute/path/to/agent-loop-tools ./agent-loop-core-0.1.0.tgz

AGENT_LOOP=/absolute/path/to/agent-loop-tools/node_modules/.bin/agent-loop
$AGENT_LOOP doctor \
  --repo /absolute/path/to/target \
  --state-root /absolute/path/to/agent-loop-state \
  --json

$AGENT_LOOP run \
  --repo /absolute/path/to/target \
  --state-root /absolute/path/to/agent-loop-state \
  --work-item /absolute/path/to/bug-fix.md \
  --acknowledge-unsandboxed-credential-access \
  --json

# If a process was interrupted after canonical evidence was persisted but before
# its in-progress claim reached done/failed, finish that deterministic transition:
$AGENT_LOOP recover \
  --repo /absolute/path/to/target \
  --state-root /absolute/path/to/agent-loop-state \
  --run-id <immutable-run-id> \
  --json
```

The target owns `.agent-loop/config.json`; claims, evidence, worktrees, and logs belong under the
separate state root. The first productized slice runs only a bounded `bug-fix` work item, creates no
remote Git operation, and never pushes or merges. The Hermes maker is not OS-sandboxed: use only a
disposable or trusted non-production target, keep credentials out of target configuration, and
acknowledge the inherited credential access explicitly.

`recover` never invokes Hermes or reruns target tests. It succeeds only when immutable run state,
canonical evidence, the complete matching ledger row, and the claimed work-item digest agree. It
reconciles exact retries and hard-link crash residue; missing or conflicting state fails closed.

See the installation and operating guides in `vault/operations/` for configuration, ownership,
upgrade, and uninstall details.

## Use the legacy template in a new project

```bash
# 1. Copy the legacy template in, one level under your repo root
cd /path/to/your-project
npx degit your-org/agent-loop-core agent-loop

# 2. Reset instance data + check STACK.md
node agent-loop/init.mjs

# 3. Fill in agent-loop/STACK.md — your database / ORM / auth / services layer

# 4. Run one tick (empty inbox is fine — it just heartbeats)
node agent-loop/orchestrator/tick.mjs
```

For Claude Code users, `init.mjs` installs `.claude/commands/orchestrate.md` at the consuming
project root (without replacing an existing command). It provides `/orchestrate <request>`: draft
and validate a work item, get one start approval, then run the routed pipeline and record its
outcome. `/orchestrate plan` is a dry-run; plain `/orchestrate` processes already queued work.
The command reads `STACK.md` rather than assuming a particular database, auth provider, or
deployment platform. Existing projects should copy the command manually rather than re-run
`init.mjs`, which resets loop state.

The pipelines are already project-neutral: they refer to your stack by **role** (the
database, the data layer, the auth provider, the services layer) and defer the concrete
tool/path to [`STACK.md`](STACK.md). Fill that one file in and every pipeline knows your
stack — no need to edit 50 pipeline files. `init.mjs` wipes any leftover run/queue data to
a clean slate and warns you about STACK.md rows you haven't filled in yet.

## Knowledge vault

The repository root is also a zero-plugin Obsidian vault. Open this folder in Obsidian and
start at [`vault/obsidian.md`](vault/obsidian.md). The curated `vault/` layer provides Maps of
Content, architecture explanations, operational guides, recommendations, and reusable note
templates without moving any path used by the machinery.

Three knowledge layers stay separate:

- operational contracts remain at their existing paths under `pipelines/`, `orchestrator/`,
  and the repository root;
- compact evidence consumed by `pipeline-improve` remains in `memory/`;
- richer human context lives in `vault/`, with consuming-project knowledge protected under
  `vault/project/`.

Shared repository-safe Obsidian settings are committed. Personal layouts, plugins, themes,
caches, hotkeys, and project attachments are ignored.

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
├── vault/               ← curated human knowledge + protected project skeleton
├── .obsidian/           ← repository-safe shared Obsidian settings
├── .claude/commands/    ← bundled `/orchestrate` source; init installs it at the project root
└── scripts/             ← regression checks + dashboard (run scripts/check-machinery.sh)
```

## Keeping the machinery healthy

`scripts/check-machinery.sh` runs the regression suite over the orchestrator, dispatch,
eval scoring, metrics, and knowledge-vault invariants. Run it after touching machinery or
curated knowledge. It needs Node ≥ a version with `node:test` (Node 18+).

## Updating the legacy template across projects

The legacy template remains copy-and-own, not a submodule. When you fix its machinery here, re-copy the changed
`.mjs`/`scripts` files into each consuming project. If you ever run 3+ projects that all
need the same machinery fixes fast, revisit a git-subtree link — until then, copy wins.
