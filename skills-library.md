# Skills Library — the loop toolkit we already have installed

> The parts we assemble from. We do **not** hand-roll loop plumbing — these skills
> already implement the [loop anatomy](./agent-loop.md). Ranked by the one principle
> that decides everything: **maker ≠ verifier** (the agent doing the work must not be
> the agent that grades it).
>
> Keep this current: when a skill is added/removed/changed, update the row **and** log
> it in [`memory/changelog.md`](./memory/changelog.md).

---

## Engines — the thing that *runs* a loop

> **All built-in. No external dependency.** We deliberately do **not** depend on `paseo-loop`
> (it needs the third-party Paseo daemon) — see [decision](./memory/decisions.md). Everything
> here ships with Claude Code, so agent-loop keeps working even if other tools are uninstalled.

| Primitive | What it does | Maker≠Verifier | Use it for |
|---|---|---|---|
| **`Workflow`** (built-in) | deterministic multi-agent script: run `execute` → `eval`, **loop-until** eval passes; each stage is a separate `agent()` call; you set the bounds | ✅ **real separation** — `execute` and `eval` are different sub-agents with their own context; the verifier only sees the diff + check output, not the maker's reasoning. Can even run eval on a different model via `agent(..., {model})` | **Default runtime** for any pipeline's `execute ↔ eval` cycle |
| **`Task` / `Agent`** (built-in) | spawn one sub-agent with a fresh context | ✅ separation = execute-agent and eval-agent are separate spawns | Simple pipelines, or driving stages by hand before scripting |
| **`/optimisation-loop`** | drive a metric to a target: measure → change one thing → re-measure | ✅ the metric (a tool's number) is the check | A **perf pipeline** (Lighthouse, LCP, bundle size, query latency) |
| **`/code-build-loop`** | ship a feature/task: goal → plan → sign-off → build → `/code-review --fix` → `/verify` | ⚠️ **self-review** (same agent builds + checks) | The **bug/feature pipeline** — but bolt on a separate `eval` verifier |

**Deliberately not used:** `paseo-loop` (external Paseo daemon — we stay independent) ·
`ralph-loop` (agent judges its own exit — fails maker≠verifier).

## Authoring — the thing that *writes* a loop

| Skill | What it does | Use it for |
|---|---|---|
| **`/build-loop "<idea>"`** | scaffolds a new loop skill "safe by construction" (`gate → skills → goal+verification → guardrails → memory → trigger`) | Generating each new **pipeline** — force it to emit a *separate verifier* |
| **`/build-loop --audit`** | scores whether a task is even a good loop candidate | Vetting a task **before** we build a pipeline for it |

## Triggers — the thing that *starts* a loop

| Skill | What it does | Use it for |
|---|---|---|
| **`/loop [interval] <cmd>`** | run a prompt/command on a cadence (or self-paced) | The **orchestrator's heartbeat** (check inbox every N min) |
| **`/schedule`** | cron the run in the cloud | Unattended, terminal-closed operation |

## Verification — the *checker* half (the load-bearing part)

| Skill | What it does | Use it for |
|---|---|---|
| **`/verify`** | drives the change end-to-end, observes real behavior | An `eval` stage that must confirm behavior, not just tests |
| **`/code-review` (`--fix`)** | reviews the diff for bugs + simplifications | An `eval` stage on any code-writing pipeline |
| **`/qa`** | browser-drives routes, finds + fixes broken flows | An `eval` stage for UI pipelines |

## Delivery capabilities — the domain workflows delivery pipelines wrap

| Skill | What it owns | Delivery pipeline boundary |
|---|---|---|
| **`/ship`** | prepares, verifies, commits, pushes, and opens or updates a reviewed change | prerequisite for `landing`; landing never recreates change preparation |
| **`/setup-deploy`** | persists platform, target, status, and health configuration | prerequisite for `deploy` when the target is not already unambiguous |
| **`/land-and-deploy`** | readiness, merge, deploy, one-pass health verification, and approved revert handling | `landing` uses its landing portion; `deploy` uses its deploy portion; `release` consumes their verified records |
| **`/canary`** | bounded post-deploy differential observation with screenshots and alerts | execution engine for `canary`; rollback remains a separate gate |
| **`/document-release`** | pre-merge documentation and release-note accuracy | notes engine for `release`; already-landed work must bring verified notes rather than rewrite history |

## Orchestration primitives (built-in, not skills)

| Tool | What it does | Use it for |
|---|---|---|
| **`Task` / `Agent`** | spawn a sub-agent with its own context | Each pipeline **stage** = one sub-agent (fresh, lean context) |
| **`Workflow`** | deterministic multi-agent script (fan-out, pipeline, loop-until) | The **orchestrator** + parallel pipeline runs, when we outgrow `/loop` |
| **git worktrees** (Conductor) | isolated repo copies | **Guardrail**: parallel pipelines that don't collide |

---

## The mapping to our design (one glance)

```
Orchestrator heartbeat ....... /loop  or  /schedule
   └─ dispatches a pipeline ... Workflow  (execute → eval, loop-until pass)
        explore ............... agent()/Task (read-only)
        plan .................. agent()/Task
        execute (MAKER) ....... agent()/Task, in a worktree
        eval    (VERIFIER) .... separate agent()/Task  ·  /verify  ·  /code-review  ·  /qa
   perf pipelines ............. /optimisation-loop   (metric = airtight check)
   authoring new pipelines .... /build-loop  (+ --audit to vet first)
```

The only piece none of these gives us is the **orchestrator/router** over *many*
pipelines — that's the new thing we build. Everything below it already exists.
