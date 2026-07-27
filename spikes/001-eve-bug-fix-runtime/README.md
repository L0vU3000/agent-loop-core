# Spike 001: Eve bug-fix runtime adapter

## Question

**Given** `agent-loop-core` can deterministically route and record work but cannot invoke its current Workflow harness from Node, **when** Eve executes one fixture `bug-fix` pipeline, **then** can it preserve the existing run-id, rubric-lock, maker/verifier, bounded-loop, and objective-record contracts while surviving a runtime restart?

## Verdict: PARTIAL

The integration boundary is viable and the deterministic fixture works through Eve's real harness. A manually controlled stop/start also resumed the same durable session and recovered its `defineState` values.

The spike is not yet a production bug-fix executor: specialist outputs are deterministic fixtures, no real repository is edited in an Eve sandbox, and a rapid automated restart loop can strand a local-world turn in `running` under Eve `0.27.1` when prior waiting runs are re-enqueued.

## Scope and safety

This is a disposable, non-production spike. It does not:

- modify any existing pipeline contract;
- use production credentials or a real model provider;
- replace the VPS's system Node 22 runtime;
- install Docker or require KVM;
- merge, push, or deploy code;
- run a real repair against Valgate.

Eve `0.27.1` is invoked with ephemeral Node 24 via `npm exec --package=node@24`. The agent uses Eve's deterministic `mockModel`.

## Architecture discovered

Eve snapshots only the application root. An authored tool inside `agent/` therefore cannot import `orchestrator/dispatch.mjs` above the Eve app root. The working boundary is:

```text
host control plane
  control-plane/dispatcher-adapter.mjs
    -> canonical planDispatch(), claimItem(), recordOutcome()

Eve snapshot
  agent/lib/runtime-adapter.mjs
    -> immutable run state
    -> locked rubric
    -> bounded verification loop
    -> exact maker-commit handoff
    -> objective pass decision

  agent/tools/*
    -> session-scoped durable defineState transitions

  agent/subagents/{explorer,planner,maker,verifier}
    -> separate Eve subagent sessions
```

This preserves `agent-loop-core` as the routing and policy source of truth while keeping the Eve runtime portable and snapshot-safe.

## Separately validated contracts

The host control-plane test and Eve eval validate opposite sides of the adapter boundary. They are **not yet one end-to-end claim → Eve session → record transaction**: the fixture filename is shared by convention, and no callback currently carries terminal Eve evidence into `recordOutcome()`.

- Canonical dispatcher selects and atomically claims the fixture item.
- One run ID is retained across every transition.
- A locked rubric may replay idempotently but cannot change silently.
- Verification cannot run until a maker branch and commit are recorded.
- The verifier commit must exactly match the maker commit.
- A failed attempt clears the maker artifact and advances only within `maxIterations`.
- A nominal pass below the rubric threshold is treated as failure.
- Recording pass requires both verifier pass and checked/passed objective gates.
- Canonical `recordOutcome()` performs the final inbox archive operation.

## Run locally

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run eve:info
npm run eve:build
npm run eve:eval
```

All Eve commands run under ephemeral Node 24. `node --version` for the VPS remains unchanged.

## Verified evidence

- System Node remained `v22.23.1`.
- Eve ran under ephemeral Node `v24.18.0`.
- Runtime adapter unit suite: 5/5 passed.
- Eve agent discovery: root agent, 4 declared subagents, and authored tools compiled with zero diagnostics.
- Eve eval: 16/16 gates passed, including a failed first attempt, successful second attempt, ordered control tools, all four subagents, dynamically derived maker artifacts and verifier targets, objective gate, and final pass response.
- Eve production-style local build completed successfully.
- Manual restart test:
  1. First turn completed and persisted session `wrun_01KY7YA06RF6RPD3VNENKDGQR3`.
  2. The Eve server process group was stopped and port `43210` was confirmed closed.
  3. A fresh `eve start` process used the same `.eve/.workflow-data` store.
  4. The saved `SessionState` resumed successfully.
  5. `inspect_state` returned run `run-fixture-001`, iteration `2`, phase `completed`, the locked 64-character rubric hash, and final maker commit `def5678`.

## Known limitation

A fast automated stop/start harness was attempted after many eval-created waiting runs existed in `.eve/.workflow-data`. Eve logged that it re-enqueued active runs, and the resumed root turn remained `running` even though its child verifier workflow was completed. The slower manual restart succeeded.

The 16-gate retry eval also emits Eve `0.27.1` harness warnings after the behavioral assertions pass: `MaxListenersExceededWarning` at 11 stream listeners and a shutdown-time queue HTTP 503/socket hang-up. These did not fail the eval, but they should be resolved or reproduced against the intended workflow world before production use.

Do not use the current local-world result as proof of crash safety under restart storms. Before production use, reproduce this against:

- a clean per-test local-world directory;
- the intended persistent workflow world, likely PostgreSQL for self-hosting;
- a real model and sandboxed Git branch handoff;
- an interrupted mid-turn, not only a restart between waiting turns.

## Recommendation

Proceed only to a second, still non-production spike that replaces the deterministic maker/verifier outputs with a real disposable fixture repository and separate Eve sandboxes. Keep Eve optional and keep the host control-plane adapter outside the Eve snapshot.
