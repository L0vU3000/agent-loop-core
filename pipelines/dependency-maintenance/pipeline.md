---
name: dependency-maintenance
category: maintenance
type: dependency
---

# Pipeline: dependency-maintenance

> Reduces one verified npm dependency backlog in small batches. Each batch updates only the
> versions named in an approved Plan, keeps product behavior unchanged, and must pass an
> independent build, test, type, lint, and dependency check before it becomes the next baseline.

## Goal

Reduce the recorded npm dependency backlog without changing product behavior:

```text
backlog = keys in `npm outdated --json`
        + `npm audit --json` metadata.vulnerabilities.total
```

The two source lists stay separate in run notes so an overlapping outdated and vulnerable package
cannot be mistaken for two distinct packages. The combined count is only the monotonic run metric.

## Scope gate

Explore accepts a work item only when it names this repository and permits a bounded npm dependency
batch. It may discover the exact packages from the lockfile and npm registry. It refuses and routes:

- a major upgrade, framework migration, or compatibility rewrite to `technical-plan` then `feature`;
- a package removal that changes a user-facing capability to `feature`;
- an upgrade requiring a schema or data change to `migration`;
- a request to suppress, ignore, or reclassify audit findings instead of correcting them.

Patch and minor updates are eligible. Runtime packages receive a smaller batch and must be called
out in Plan. A package with unclear release notes, peer constraints, or behavior impact is deferred.

## Exit condition

One batch passes only when every check is true:

1. The combined backlog is strictly below the last independently accepted count.
2. Every planned package is installed at the approved version in `package.json` and
   `package-lock.json`; no unplanned direct dependency changed.
3. `npm run build` succeeds.
4. `npx vitest run` succeeds.
5. `npx tsc --noEmit` reports zero errors.
6. `npx eslint app lib components` adds no warnings versus Explore.
7. The diff contains only dependency manifests, lockfile changes, and compatibility edits named in
   the approved Plan. Product behavior and copy are unchanged.

The pipeline is done when the backlog is zero or every remaining entry is explicitly deferred with
an owner-visible reason. Otherwise, the accepted batch is checkpointed in the isolated worktree and
the next batch returns to Plan.

## Verification technique

This pipeline uses a **before/after backlog count plus repository gates**. The verifier reads npm's
JSON output rather than console wording, checks the resolved versions in both manifests, builds the
application, and reruns the repository gates. The metric catches a batch that did not reduce upkeep;
the build and regression gates catch a reduction that broke the product.

Registry state can change during a run. A newly published version or advisory may make the current
count rise even when the planned package installed correctly. That iteration fails honestly and goes
back to Plan with both JSON snapshots; the verifier never edits the baseline to manufacture progress.

## Stages

`explore → plan → execute → eval`. Execute is the maker. Eval is a fresh, different-model verifier.
Every Eval failure writes evidence and returns to Plan before another Execute attempt.

## Guardrails

- **Training mode:** locked on while unproven. Every batch stops after Plan and resumes only with
  `--resume=<run-id> --approved-plan`.
- **Isolation:** one run per git worktree. Successful batches create local checkpoint commits only;
  they are never pushed or landed by this pipeline.
- **No database access:** never connect to Neon and never run `seed:reset`.
- **Small batches:** 1–5 runtime packages or 3–8 development packages. Do not mix a risky package
  into a mechanical batch.
- **Bounds:** at most 6 accepted or rejected batch attempts, 7 agent calls per invocation, and a
  declared 45,000-token ceiling enforced through the Workflow budget when available.
- **No progress:** stop after the same verifier failure repeats twice or no eligible package remains.
- **Human checkpoints:** approve every Plan; separately approve any future proposal to admit a major
  upgrade. Training mode cannot be disabled by a runtime flag.
- **Memory:** append proven dependency landmines to `agent-loop/memory/errors.md`.

## Status and trigger

Authored, structurally checked, and awaiting its first genuine dependency work item. Pass the inbox
ticket path to `workflow.js`. The first invocation writes Explore and Plan notes, then returns the
run ID needed for the approved resume.
