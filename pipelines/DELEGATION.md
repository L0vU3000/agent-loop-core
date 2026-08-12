# Shared delegation contract — the team inside a pipeline

> A pipeline is a **team**, not a person. Its `execute` stage may run as a **lead** who splits the
> approved plan into sub-tasks, hands each to a **worker**, **desk-checks** what comes back, and
> only then reports one assembled result up. Eval is unchanged: the team still hands exactly one
> verified result to the orchestrator.

This is the same relationship [`EVAL.md`](./EVAL.md) has to scoring — a contract every pipeline
follows, implemented inside each pipeline rather than imported. Workflow scripts have no module
system, so the shape is written down once here and the code lives in each `workflow.js`.

## The org, in full

| Layer | Who | Job |
|---|---|---|
| `orchestrator/dispatch.mjs` | **the router** | reads the inbox, assigns one ticket to one team, records the outcome |
| `pipelines/<name>/workflow.js` | **the team** | owns `explore → plan → execute → eval` for that ticket |
| `execute`, delegating | **the lead** | splits the plan, delegates, desk-checks, assembles, reports up |
| worker agents | **the engineers** | each builds exactly one sub-task |
| `eval` | **the team's QA** | independent verifier; the team's hand-off to the router |
| record gate | **the merge gate** | re-runs objective checks at the one doorway |

Two levels of delegation. **A worker never delegates.** Recursive spawning is the failure mode that
turns one ticket into a 10x bill, and nothing in this system needs a third level.

## When the lead delegates

Delegation costs roughly an order of magnitude more tokens than one agent doing the work, so it
must earn its keep on every run:

- **Two or more genuinely independent sub-tasks** → delegate. Independent means neither needs the
  other's output — and, for a team that writes code, that they touch different files.
- **One sub-task, or sub-tasks that must happen in order** → **solo path.** The lead does the work
  itself, exactly as a non-delegating pipeline does. This is the default, and it is not a failure.

"Steps I could do in sequence" are not sub-tasks. If splitting the plan does not remove wall-clock
or context pressure, it is an org chart drawn for its own sake.

## Rules the code must enforce

Prompts are requests, not guarantees. A lead asked for "at most 4 sub-tasks" will some day return
40 — over-spawning is the single most reported failure of this pattern, and a plausible plan is
exactly how it happens. So every one of these is enforced in the workflow's own JavaScript:

1. **Worker cap.** The proposed split is truncated in code (`slice(0, MAX_WORKERS)`), never merely
   requested in the prompt. `MAX_WORKERS` is small — 4 unless a pipeline proves it needs more.
   The truncation is logged: a silent cap reads as "the plan was followed".
2. **Solo threshold.** One or zero sub-tasks takes the solo path. No delegation tax on simple work.
3. **Desk check per worker.** Every returned sub-task is reviewed by a **different agent than the
   one that built it** — maker ≠ verifier, one level down. An unreviewed sub-task is not accepted.
4. **Bounded rework.** A rejected sub-task gets `MAX_REWORK` retry (1), carrying the reviewer's
   reason. Still rejected → the lead reports the failure up rather than looping.
5. **No recursion.** A worker prompt must forbid delegating further.
6. **Disjoint writes, for a writing team.** Workers run CONCURRENTLY in one shared worktree, so on
   a pipeline that changes code the split is only safe when each sub-task declares the exact files
   it will write and those sets do not overlap. Checked in code; overlap — or a sub-task that
   declares no files at all — collapses the whole split to the solo path. A prompt asking workers
   to stay in scope is not a lock. Read-only teams skip this: they have nothing to clobber, which
   is why they are the safer place to adopt delegation first.
7. **The lead reports honestly.** A sub-task that never passed its desk check is reported as
   incomplete. The lead must not paper over a worker's failure — Eval will find it, and a lead that
   hides it has only spent tokens to delay the same verdict.

## Writing teams vs read-only teams

| | splits by | the workers' output is | extra rule |
|---|---|---|---|
| **writing** (`feature`, …) | file sets | the product itself | file sets must be disjoint |
| **read-only** (`research`, `code-review`, …) | questions or lenses | raw material | the lead assembles one deliverable |

A read-only team needs one more stage: notes and per-lens findings are not the deliverable, so the
lead **synthesizes** or **merges** them into the single report Eval will score. Prefer distinct
lenses over N reviewers repeating one pass — redundancy finds the same defect four times, diversity
finds four defects.

## What does not change

- Eval still scores the assembled result against the rubric Plan locked before Execute began.
- Maker ≠ verifier still holds at the team level: the lead and its workers are all makers, and
  Eval is a separate agent from all of them. A desk check is **not** a substitute for Eval — it is
  a cheaper, earlier filter that keeps obvious defects out of the assembled result.
- The run folder is still `runs/<run-id>/`, one shared run-id. Workers write into it; they do not
  mint their own.

## Adoption

A pipeline opts in by implementing this shape in its `execute` stage. Most should not. Sequential
work (`migration`, `entity-scaffold`, `performance-burndown`), single-root-cause work (`bug-fix`),
shared-artifact work (`dependency-maintenance`, where parallel workers fight over one lockfile), and
everything in `delivery` (ordered, approval-gated, external state) stay solo on purpose.

Adopt where the work genuinely splits — then keep the solo path, because most tickets will still
take it.

`scripts/check-delegation.regression.mjs` drives every delegating workflow with a lead that proposes
far more workers than the cap, and fails if the extra ones run. Add a pipeline to its `TEAMS` table
when it starts delegating — that is how it earns its coverage.

Adopted so far: `feature` (writing), `research` and `code-review` (read-only).
