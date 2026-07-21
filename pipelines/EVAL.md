# Shared Eval scoring guide

> Every pipeline uses this scoring contract. The pipeline's Plan creates the rubric for the
> current task; a fresh Eval agent applies that rubric to evidence after Execute.

## Why scoring is task-specific

A feature, database entity, lint batch, and browser QA run do not have the same definition of
quality. Plan therefore writes the scorecard before Execute begins, when the intended outcome is
still explicit and before anyone knows which criteria will be convenient to pass.

The scorecard always totals **100 points**. Plan also chooses a pass threshold from **80 to 100**;
use **85** when the task gives no reason to choose another value.

## Required Plan rubric

Every `runs/<run-id>/plan.md` must contain this table:

```markdown
## Eval rubric

Pass threshold: 85/100
Prior failures reviewed: <errors.md entry ids + recent eval ids carried forward, or "none relevant — <reason>">

| Criterion | Weight | Critical? | Evidence | Full-credit rule | Partial-credit rule |
|---|---:|:---:|---|---|---|
| <task-specific outcome> | <points> | yes/no | <command, test, trace, or diff> | <objective result> | <objective bands or none> |
| ... | ... | ... | ... | ... | ... |

Total: 100
```

Rubric rules:

1. Criteria must be specific to the task described by Explore and the ticket.
2. Weights are whole numbers and must total exactly 100.
3. The pass threshold must be between 80 and 100.
4. Every criterion names evidence that Eval can independently collect.
5. Partial credit is allowed only when the Plan defines objective scoring bands in advance.
6. The pipeline's existing safety, regression, authorization, data, approval, and anti-gaming
   checks remain **critical**. Plan may weight them, but it may not remove or soften them.
7. At least one criterion must be critical.
8. After the first Eval begins, the rubric, weights, and threshold are locked. A retry may revise
   the implementation plan, but changing the rubric requires explicit human approval.
9. Plan hashes the exact `## Eval rubric` section with SHA-256 and returns that fingerprint to the
   workflow. Retries must return the same fingerprint unless a human approves a rubric change.
10. **History-aware — a known failure is never silently dropped.** Before authoring the rubric,
    Plan reads [`../memory/errors.md`](../memory/errors.md) and the most recent eval failures for
    this pipeline's `type`, and fills the `Prior failures reviewed` line naming what it checked and
    what it carried forward (or `none relevant` with a one-line reason — the human approver sees
    this). Any past failure that could recur in this task becomes a criterion, marked **critical**
    when the original miss was a safety, regression, authorization, data, or anti-gaming failure.
    The fresh rubric is task-specific *and* stands on every past failure.

## How Eval scores

Eval is read-only and independent from the maker. It reads Explore, the Plan rubric, Execute
notes, and the diff; then it gathers the rubric's evidence itself.

For every criterion, Eval records:

- points earned out of its planned weight;
- pass, partial, or fail;
- whether a critical criterion failed;
- the exact command output, trace, screenshot, or diff that supports the score.

Eval must not invent a criterion, change a weight, reinterpret the threshold, or award
unexplained partial credit.

## Pass and fail calculation

```text
PASS = score >= Plan threshold
       AND critical failures = 0
       AND rubric is unchanged and valid

FAIL = score < Plan threshold
       OR critical failures > 0
       OR rubric is missing, invalid, or changed without approval
```

A high score never compensates for a critical failure. For example, a feature scoring 94/100
still fails if its authorization check fails or its acceptance test was weakened.

## Required Eval output

Write `runs/<run-id>/eval.md` with:

```markdown
verdict: pass | fail
score: <earned>/100
threshold: <planned>/100
critical-failures: <count>
rubric-valid: yes/no

| Criterion | Weight | Earned | Result | Evidence |
|---|---:|---:|---|---|
| ... | ... | ... | pass/partial/fail | ... |

reason: <one sentence>
next: done | return-to-plan | human-review
```

The workflow's structured result returns the same `score`, `passThreshold`, and
`criticalFailures` values so deterministic runtime code, rather than the maker, decides whether
the loop exits.

## What happens after a failure

1. Eval writes the scorecard and evidence. It does not edit code or prescribe a repair.
2. The workflow returns to Plan with the failed criteria and score.
3. Plan revises the implementation approach without lowering weights, changing the threshold,
   or removing critical criteria.
4. Execute makes the next bounded attempt.
5. A fresh Eval agent scores the complete rubric again; points do not carry across attempts.
6. The pipeline stops for human review when it reaches its attempt bound, repeats the same
   failure without progress, or needs a rubric change.

**Durable artifact — the eval set grows from real failures.** Where a failed (or newly fixed)
criterion is objectively checkable, the fix must leave a **permanent regression check** in the
repo — a test, fixture, or machinery assertion — not only an `errors.md` note. `errors.md` holds
the lesson; the persisted check is the enforcement, re-run by every future objective gate (and by
the record doorway). This is how a Plan-authored, per-run rubric still accumulates a growing set of
real-failure cases instead of resetting each run: rule 10 pulls that history *into* the next rubric,
and this rule pushes each failure *out* into a durable check.
