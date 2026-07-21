---
name: performance-burndown
category: maintenance
type: perf
---

# Pipeline: performance-burndown

> Moves one named performance metric on one named surface toward an approved target. It uses the
> installed `optimisation-loop` method: lock a measurement recipe, take a median baseline, apply one
> attributable change, remeasure under the same conditions, and keep only independently verified
> gains that preserve behavior.

## Goal

Reach one quantitative target, expressed as:

```text
<metric> <≤|≥> <target> <unit> on <route, asset, or query>
```

Examples include LCP, TTFB, Lighthouse performance score, route JavaScript size, and a named query's
latency. The target, direction, unit, surface, data fixture, measurement tool, cache state, sample
count, and environment are locked before Execute.

## Scope gate

The ticket must name the metric, target, direction, unit, surface, and why the target matters. Explore
must be able to write one repeatable command or browser recipe and collect at least three comparable
samples. It refuses:

- a qualitative request such as "make it feel faster" without an instrumented metric;
- a conversion or production-traffic metric without an approved slow-feedback experiment contract;
- a change that removes behavior, changes UX, weakens quality, or alters the measurement recipe;
- production database measurement or any write query;
- a target whose baseline cannot be reproduced in the isolated environment.

Database latency work may use `EXPLAIN (ANALYZE, BUFFERS)` only on an approved Neon development branch
with a read-only query and fixed fixture. It never connects to production and never runs `seed:reset`.

## Exit condition

An attempt passes only when every check is true:

1. The verifier uses the locked recipe and reports the median of the planned sample count, at least 3.
2. The median strictly beats the last accepted best in the target direction and meets any predefined
   minimum detectable improvement. The pipeline finishes only when the target is also met.
3. The named behavior check passes and the surface's observable content and interactions are unchanged.
4. `npx vitest run` succeeds.
5. `npx tsc --noEmit` reports zero errors.
6. `npx eslint app lib components` adds no warnings versus Explore.
7. The diff contains one planned performance lever and no measurement, test, behavior, or unrelated drift.

A verified gain below target becomes the new best and returns to Plan. A tie, regression, incomparable
run, or behavior failure is rejected and returns to Plan. Two consecutive no-progress attempts stop.

## Verification technique

This pipeline uses **median-of-N repeated measurement plus an independent behavior gate**. The median
reduces one-off timing noise; fixed route, viewport/device, fixture, cache state, build mode, command,
and sample count make before/after numbers comparable. Plan defines any minimum detectable improvement
before Execute so a tiny fluctuation cannot be scored as a win.

The verifier, not the maker, performs the final measurement. It compares against the last accepted best,
not merely the original baseline or target. A local checkpoint commit is created only after Eval accepts
the gain, giving the next attempt a clean ratchet point in the isolated worktree.

## Stages

`explore → plan → execute → eval`. Execute is the maker; Eval is a fresh, different-model verifier.
Every failed Eval returns its evidence to Plan before another attempt.

## Guardrails

- **Training mode:** locked on while unproven. Every performance lever stops after Plan and resumes only
  with `--resume=<run-id> --approved-plan`.
- **One lever per attempt:** no bundles of unrelated optimizations.
- **Fixed measurement:** recipe, target, direction, unit, sample count, and minimum detectable improvement
  cannot change after baseline without a new owner-approved run.
- **Isolation:** one run per git worktree. Accepted gains may create local checkpoint commits; this
  pipeline never pushes, merges, deploys, or releases them.
- **Bounds:** at most 6 attempts, 7 agent calls per invocation, and a declared 50,000-token ceiling
  enforced through the Workflow budget when available.
- **No progress:** stop after two consecutive rejected attempts or when Plan has no untried grounded lever.
- **Data safety:** Neon development branch only for query work; read-only measurement; never production,
  destructive SQL, or `seed:reset`.
- **Memory:** append measurement landmines and rejected levers to `agent-loop/memory/errors.md`.

## Status and trigger

Authored, structurally checked, and awaiting a genuine performance ticket. Pass the ticket path to
`workflow.js`. The first invocation records the reproducible baseline and Plan, then returns the run ID
for the approved resume.
