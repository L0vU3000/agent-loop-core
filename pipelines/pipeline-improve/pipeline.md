---
name: pipeline-improve
category: maintenance
type: pipeline-improve
---

# Pipeline: pipeline-improve

> Reads agent-loop memory and recent run evidence, selects one machinery weakness, changes
> only that weakness, and requires an independent verifier to prove the system is clearer
> or stronger.

## Goal

Complete one evidence-backed pipeline-system improvement without widening scope or reducing
an existing safety or verification signal.

## Selection gate

Explore must identify one concrete failure, recurring lesson, drift risk, or weak check from:

- `agent-loop/memory/errors.md`, `decisions.md`, and `changelog.md`;
- the newest completed and failed `pipelines/*/runs/*/eval.md` evidence;
- current machinery scripts, pipeline definitions, and routing registries.

The candidate must have a reproducible current weakness and a deterministic check that can
fail before the improvement and pass after it. If the weakness is already protected, Explore
must reject it and select the next highest-impact evidenced issue. A run may change exactly
one machinery behavior. Broad rewrites, product features, database work, the orchestrator
implementation, and a second pipeline are out of scope.

## Exit condition

A run passes only when all checks are true:

1. Explore cites the source evidence and proves the selected protection is missing or weak.
2. The approved Plan names one improvement, its exact files, and a deterministic red-to-green
   regression check. No tracked machinery file changes before Plan approval.
3. Execute implements only the approved improvement and does not commit it.
4. A fresh verifier proves the focused check fails on the controlled old/drifted condition and
   passes on the corrected condition.
5. `bash agent-loop/scripts/check-machinery.sh`, `npx vitest run`, `npx tsc --noEmit`, and
   `npx eslint app lib components` all retain or improve their starting health — confirmed by an
   independent gate-runner agent (separate from the rubric verifier), with ESLint measured against
   Explore's pre-change baseline. The rubric verifier's self-report of these gates must match the
   gate runner; a mismatch fails the run.
6. No Eval check, regression gate, approval gate, database guardrail, or maker/verifier split
   is removed, skipped, relaxed, or made optional.

## Verification technique

This pipeline uses a **focused regression fixture plus full machinery and repository gates**.
The focused fixture reproduces the selected machinery failure without editing the live
worktree, then proves the new protection rejects that failure and accepts the valid state.
The separate verifier inspects the diff and reruns the commands; the maker's report cannot
serve as the verdict. Because `workflow.js` runs in the Workflow sandbox and cannot run shell
commands itself, the objective gates are executed by a third agent — a mechanical gate runner
with no rubric role — and the run passes only when the gate runner is green *and* the rubric
verifier's independent self-report of those same gates matches it. This corroboration is the
strongest fail-closed check available until a dispatcher can run the gates deterministically
outside the sandbox.

For the first proof, the selected weakness is pipeline-registry drift. Pipeline frontmatter
is the canonical routing metadata, while `categories.md`, `pipelines/README.md`, and the
orchestrator registry are checked projections. The regression fixture changes one projected
type in a temporary copy and requires a failure before restoring the matching metadata.

## Guardrails and bounds

- **Isolation:** one run per Conductor/git worktree. Never edit another active worktree.
- **Scope:** one machinery improvement per run. Do not build product code, the orchestrator,
  another pipeline, or broad documentation rewrites.
- **Approval:** training mode is always on. The workflow stops after Plan and resumes only
  with the same run ID plus `--approved-plan`.
- **Verification:** Execute uses `opus`; Eval uses `sonnet`. Eval is read-only and does not
  suggest repairs.
- **Database:** no database changes or writes. Never use production, `seed:reset`, or
  `ALLOW_DESTRUCTIVE_DB=1`.
- **Bounds:** at most 3 recorded attempts, 45 minutes of call-launch time, 8 agent calls per
  invocation, and a declared 45,000-token ceiling.
- **No progress:** stop when the same verifier failure repeats twice consecutively.
- **Memory:** every failed Eval appends a factual Symptom / Cause / Fix / Prevention entry to
  `agent-loop/memory/errors.md`. Unknown causes stay explicitly unknown.

The Workflow API can prevent new calls after the time or agent-call bound, but it cannot
cancel a call already in flight. It does not expose live token usage, so the agent-call cap
is the enforceable local proxy and the token ceiling remains declarative until a dispatcher
can enforce it at launch. The approval flag proves the caller resumed intentionally; the
current runtime does not authenticate the human identity behind that flag.

## Status and trigger

Proven by hand on run `2026-07-16-004245`: a controlled registry mismatch passed the old
machinery check, then the focused fixture turned red on drift and green after restoration.
An independent verifier passed the focused check, eight-pipeline registry comparison,
machinery self-check, 195/195 Vitest assertions, TypeScript with zero errors, and ESLint at
55 → 55 warnings.

Invoke `workflow.js` with an optional evidence hint or leave the arguments empty to inspect
memory and recent runs. The first invocation stops after Plan. Review the exact plan, then
resume with `--resume=<run-id> --approved-plan`. Eval failure returns to a revised Plan and
requires approval again.
