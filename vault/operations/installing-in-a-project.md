---
type: operation
status: active
created: 2026-07-21
updated: 2026-07-30
tags:
  - agent-loop
  - installation
---

# Installing in a project

## Supported package runtime

Use Node 18 or newer. The package is not currently published to npm, so build a local artifact from
a trusted `agent-loop-core` checkout:

```bash
cd /absolute/path/to/agent-loop-core
npm test
npm pack --json
```

Read the `filename` returned by `npm pack --json`. Install that exact tarball under a dedicated,
absolute tools prefix outside the target repository. Do not install target dependencies:

```bash
npm install \
  --prefix /absolute/path/to/agent-loop-tools \
  /absolute/path/to/agent-loop-core/agent-loop-core-0.1.0.tgz

AGENT_LOOP=/absolute/path/to/agent-loop-tools/node_modules/.bin/agent-loop
$AGENT_LOOP --version
```

Create the target-owned configuration at `/absolute/path/to/target/.agent-loop/config.json`:

```json
{
  "schemaVersion": 1,
  "pipeline": "bug-fix",
  "test": {
    "executable": "node",
    "args": ["--test"]
  },
  "allowedPaths": ["src/add.mjs"],
  "maker": {
    "provider": "anthropic",
    "model": "claude-sonnet-5",
    "timeoutMs": 300000
  }
}
```

Replace the test arguments and allowed paths with the smallest deterministic boundary for the
repair. The test command is an executable plus literal argument array, not a shell command. Never
put credentials in config, work items, source files, or test arguments. Maker execution is bounded
by the configured wall-clock `timeoutMs`; successful runs bind Hermes usage evidence.

Choose an absolute state root outside the target and its Git metadata, then run the non-mutating
preflight:

```bash
$AGENT_LOOP doctor --repo /absolute/path/to/target \
  --state-root /absolute/path/to/agent-loop-state --json
```

A healthy result is required before `run`. The `sandbox.deferred` warning is expected in this first
slice: the maker is not OS-sandboxed. Continue only with a disposable or trusted non-production
repository and credentials that are safe for that scope. See
[[vault/operations/running-productized-transaction]] before acknowledging access.

## Legacy copy-owned template

Existing projects that intentionally need the full orchestrator and pipeline template may still
use the legacy `degit` path:

```bash
cd /absolute/path/to/consuming-project
npx degit L0vU3000/agent-loop-core agent-loop
node agent-loop/init.mjs
```

`init.mjs` clears copied instance state, preserves directory skeletons, and reports blank roles in
`agent-loop/STACK.md`. Fill the middle column of [[STACK]] with the consuming project's concrete
database, data layer, auth, services, commands, and safety boundaries. Do not put credentials in
the mapping.

Run `node agent-loop/orchestrator/tick.mjs` once; an empty inbox should heartbeat cleanly. Then open
the copied `agent-loop` folder as an Obsidian vault, visit [[vault/obsidian]], and keep
project-specific knowledge under [[vault/project/README|vault/project/]].

The legacy copy is independently owned. Read [[vault/architecture/distribution-model]] before
carrying changes between projects. Do not use `init.mjs` to install or upgrade the package runtime.
