# Agent Loops

> Goal: stop hand-prompting one task at a time. Build **loops** — small systems that
> find work, hand it to an agent, verify the result, record what happened, and decide
> the next step — so your project's work runs on a cadence instead of a keystroke.

This is the home doc. Read [`categories.md`](./categories.md) for how the orchestrator
organizes many peer pipelines across planning, building, review, testing, maintenance, and
delivery. Deep-dive sources and quotes live in [`resources/`](./resources/README.md).

---

## The one-sentence definition

> **An LLM agent runs tools in a loop to achieve a goal.** — Simon Willison

That's the whole idea. Everything below is about making that loop *reliable* and *safe*
enough to leave running.

---

## The core loop (the "heartbeat")

Every agent, from ReAct (2022) to Claude Code (2025), is the same cycle:

```
        ┌──────────────────────────────────────────┐
        │                                           │
   ┌────▼────┐    ┌────────┐    ┌─────────┐    ┌────┴─────┐
   │  PLAN   │ →  │  ACT   │ →  │ OBSERVE │ →  │  VERIFY  │
   │ (reason)│    │ (tool) │    │(result) │    │ (check)  │
   └─────────┘    └────────┘    └─────────┘    └──────────┘
      goal in        run a         read the      pass? → done
                     command       output        fail? → loop
```

- **Plan** — the model reasons about the next step (break a big goal into subtasks).
- **Act** — it runs *one* concrete tool: a shell command, a DB query, an API call.
- **Observe** — it reads the result and decides if the plan still holds.
- **Verify** — a check (ideally a *separate* agent or a test suite) confirms the work.
  Fail → loop again. Pass → exit.

**Throughput of the whole thing is set by how fast you can run one lap of that loop.**
Karpathy's point: the leverage is in *speeding up verification*, not writing longer prompts.

> **A loop is one node, not the whole picture.** IndyDevDan's counterpoint (see resources §7):
> the loop is just the *pass/fail route back to the build agent* — one piece of control flow. The
> real unit is an **AI Developer Workflow (ADW)**: prompts in → a mix of **code + agents** → results
> out. His three actors of value creation — **engineers, agents, and code** — and the reminder that
> *code is the unsung hero* (fast, deterministic, zero-token) are the frame to keep. Build a solid
> loop first, then wire loops into workflows as the work gets bigger.

**Where the graph fits.** One pipeline is one node — a full loop with its own separate verifier.
The layer above is the **edge**: whose output becomes whose input, and what state rides along it.
That layer is deliberately small. Nodes are the work; edges are only hand-offs, and every one stops
at a human who writes the successor's own exit condition — see
[Edges](./orchestrator/orchestrator.md#edges--pipeline-hand-offs). Master the loop first: a graph
of weak nodes is just a weak org.

---

## The five things that turn a chat into a loop

From Boris Cherny (built Claude Code) and Dex Horthy (12-Factor Agents):

| Piece | What it does | In practice |
|---|---|---|
| **1. Goal** | A recursive purpose the agent iterates toward | "Every failing test in the auth test suite is green" |
| **2. Verification** | A *separate* agent/test decides pass/fail — the single most important design choice | the test command, the typechecker, `/verify`, a second agent reviewing the diff |
| **3. Memory** | State written to a file so tomorrow's run resumes today's | the project conventions doc for lessons; a `progress.md` for where it stopped |
| **4. Scheduling** | Discovery + triage on a cadence, terminal open or not | cron / `/loop` / a nightly routine |
| **5. Guardrails** | Isolation + least-privilege creds so an autonomous run can't hurt you | git worktrees, test/staging DB branch, scoped keys |

> **Verification is the linchpin.** "The most consequential design choice in a loop is
> splitting the agent that writes the code from the agent that checks it." — Boris Cherny.
> If you can't check it automatically, it's not ready to be a loop yet.

---

## The four loop *types* (pick the weakest one that works)

From Anthropic's own "Getting Started with Loops." These are rungs — climb only when the
lower one isn't enough. Each maps to a command your harness already has.

| Type | Trigger | Stops when | Command | Use for |
|---|---|---|---|---|
| **1. Turn-based** | you prompt | the agent decides it's done | a normal message + a verify *skill* | one-off tasks; add a `/verify` skill so it self-checks |
| **2. Goal-based** | you, with success criteria | goal met **or** turn limit hit | `/goal` (or `/code-build-loop`) | verifiable exit: test pass-rate, tsc count, a score |
| **3. Time-based** | a clock | the interval you set | `/loop` (local) · `/schedule` (cloud) | recurring work, monitoring external systems |
| **4. Proactive** | an event, no human | you stop it | scheduling + goal + skills combined | bug triage, dependency upgrades, standing streams |

**Getting-started recipe (Anthropic):** find a bottleneck task → automate exactly *one*
element of it — the **verification check**, the **stop condition**, or the **trigger** — then
start simple and iterate. Don't build a proactive loop first; earn your way up the table.

---

## Codex's five building blocks (same idea, different vocabulary)

Daniel Vaughan's Codex CLI writeup names the same machinery, useful as a checklist:
**Automations** (cron + a persistent memory file), **Goal Mode** (runs for hours with a
*separate verifier model* — "maker–verifier separation"), **Worktrees** (parallel git
isolation), **Subagents** (read-only reviewer vs. write-enabled implementer), **Skills**
(encoded conventions). And three failure modes to design against:

- **Verification weakness** → use a *read-only* verifier, never let the maker grade itself.
- **Comprehension debt** → require human sign-off on merges; don't merge what nobody understood.
- **Cognitive surrender** → rotate who reviews, so attention doesn't rubber-stamp.

---

## The autonomy slider (don't jump to full-auto)

Karpathy: don't try to build a self-driving car on day one. Build a **co-pilot with an
autonomy slider** and slide it up only as trust grows.

```
  human-in-loop  ─────────────────────────────►  full autonomy
  suggest & wait     auto within scope        find-work + run + verify unattended
  (safest)           ("YOLO in a box")        (only where verification is airtight)
```

Rule of thumb: **the slider can only go as far right as your verification is trustworthy.**
Airtight tests → safe to automate. Fuzzy "looks good?" → keep a human in the loop.

---

## When a task is a good loop candidate

Good loops have **a clear success signal and a trial-and-error shape** (Simon Willison):

- ✅ Fix failing tests / typecheck errors (the signal is literally green/red)
- ✅ Performance or bundle-size optimization (measure → change → re-measure)
- ✅ Dependency upgrades (does it still build + pass?)
- ✅ Data-audit / wiring sweeps across many files (large codebases accumulate these)
- ❌ Anything where "done" is a matter of taste with no measurable check — keep human-in-loop

---

## Safety, non-negotiable (this is backend territory — treat it carefully)

Autonomy without guardrails is how you lose data. Before sliding right:

1. **Isolate** — run in a git worktree or container, never straight on `main`.
2. **Least privilege** — give the loop a **test/staging** DB branch and scoped keys, not prod.
   - Standing rule (see STACK.md): **never run a destructive seed reset** — it destroys evolved seed data.
   - The dev database, not the prod one, for any loop that writes.
3. **Budget the blast radius** — small scope, one domain at a time, reversible steps.
4. **Keep context lean** — Horthy's "dumb zone": model recall degrades in the middle
   40–60% of a big context window. Less context in the loop = better decisions.

---

## Loop starter ideas (ranked by how airtight the verification is)

1. **Green-the-test-suite loop** — goal: a chosen test suite stays green after edits.
   Verification = the test command. Airtight. Great first loop.
2. **Typecheck-error burndown loop** — goal: drive a backlog of type errors down.
   Verification = the typechecker's error count strictly decreasing. Airtight.
3. **Data-wiring sweep loop** — goal: eliminate mock/placeholder values across the codebase.
   Verification = a second agent checks each value traces to a real field. Semi-airtight.
4. **QA-and-fix loop** — goal: no console errors / broken flows on key routes.
   Verification = the `/qa` browser agent. Semi-airtight; keep human-in-loop early.

Start at #1, keep the slider left, move it right only after a loop proves itself.

---

## Tooling you already have for this

- **`/loop`** — run a prompt or slash command on an interval (or self-paced).
- **`/build-loop "<idea>"`** — turns a loop idea into a runnable, safe-by-construction loop skill.
- **`/code-build-loop`**, **`/optimisation-loop`** — pre-built build/verify and metric-to-target loops.
- **`/verify`**, **`/code-review --fix`**, **`/qa`** — the *verification* half of any loop.
- **git worktrees** (Conductor already gives you isolated workspaces) — the *guardrail* half.

---

## This is an evolving system

**This loop system is never finished — its own improvement is a loop.** The moment we treat
it as "done," it starts rotting: pipelines drift, the same errors recur, slow stages stay
slow. So the system must **always be searching for ways to optimize itself.**

That's what [`memory/`](./memory/README.md) is for — the agent-loop's own mini-vault, mirroring
whatever project knowledge vault you keep:

- [`memory/changelog.md`](./memory/changelog.md) — what changed in the machinery, dated.
- [`memory/decisions.md`](./memory/decisions.md) — why the loop is built this way (ADRs).
- [`memory/errors.md`](./memory/errors.md) — what broke + the lesson, which feeds back into
  the offending pipeline's prompt so the fix propagates to every future run.

**The meta-loop:** on a cadence, a review pass reads `memory/` and asks — *what's the most
common error? which stage is slowest? which pipeline has the weakest verification?* — and
proposes the next improvement. Optimizing the system that builds the system is the highest-
leverage work here (IndyDevDan's "build the system that builds the system").

For durable human context, the repository root is also an Obsidian vault. Start at
[`vault/obsidian.md`](./vault/obsidian.md). The curated vault explains architecture, research,
recommendations, and operations; compact `memory/` entries remain the machine-facing evidence
that `pipeline-improve` ranks. Consuming-project knowledge belongs under `vault/project/` and
must not be promoted upstream automatically.

---

## What's built (the scaffold)

```
agent-loop/
├── agent-loop.md          ← this hub doc
├── categories.md          ← pipeline categories + routing policy
├── skills-library.md      ← the installed loop toolkit we assemble from
├── dashboard.md           ← generated live view: running / queued / completed
├── resources/             ← the source library (8 authors)
├── vault/                 ← curated architecture, guidance, research + project-owned skeleton
├── orchestrator/          ← the router (spec) + inbox/ (work items)
├── pipelines/             ← twenty-four peer explore → plan → execute → eval workflows
├── scripts/               ← dashboard generation + machinery/registry checks
└── memory/                ← changelog · decisions · errors (self-improvement)
```

## What ships in the template

Twenty-four pipelines are defined across the categories in [`categories.md`](./categories.md):

- **building** — `feature`, `bug-fix`, `entity-scaffold`, `wiring`, `migration`, `api-tool`:
  make a change, each behind worktree + dev-database guardrails.
- **planning** — `spec`, `research`, `technical-plan`: read-only document-producers whose
  verification grades grounding, testability, and completeness rather than tests.
- **review** — `code-review`, `design-review`, `security-review`, `architecture-review`:
  read-only findings-producers verified by adversarial re-verification (a reported finding
  must reproduce, or it is dropped).
- **testing** — `qa`, `e2e-regression`, `test-coverage`, `eslint-burndown`,
  `performance-burndown`: dedicated test-health, regression, and burndown work.
- **maintenance** — `dependency-maintenance`, `performance-burndown`: approved backlog
  batches and fixed-recipe measurement toward one target.
- **delivery** — `landing`, `deploy`, `canary`, `release`: approval-gated wrappers that
  separate merge, deployment, observation/rollback, and release sign-off so one approval
  cannot silently authorize the next risk level.
- **meta** — `pipeline-improve`: the self-improvement pipeline that reads `memory/` and
  proposes the next change to the loop itself.

The orchestrator's routing + bookkeeping half is executable code — `orchestrator/dispatch.mjs`
validates each inbox item against the canonical registry, emits the dispatch plan in priority
order, and records outcomes; the Workflow runtime executes the selected pipeline. Everything
runs on built-in primitives, so the system stays independent of external agent daemons.

Each pipeline is a **template**: the methodology is generic, and stack-specific references
defer to [`STACK.md`](./STACK.md). Adapt a pipeline's prose to your project once, then run it.
