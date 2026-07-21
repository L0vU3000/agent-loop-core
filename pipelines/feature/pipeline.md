---
name: feature
category: building
type: feature
---

# Pipeline: feature

> **Pipeline #6 — build something new.** Takes a feature ticket, turns its acceptance
> criteria into *failing tests first*, builds the smallest change that satisfies them, and
> proves it with a red→green flip plus the global no-regression gates. The sibling of
> `bug-fix`: same four stages, same rigor — the difference is that `explore` writes the
> **spec as tests** instead of reproducing a defect.

## Goal

The ticket's acceptance criteria are met, **and** the acceptance tests that encode them are
green and stay in the suite so the feature can't silently regress.

## Exit condition (the check)

A run **passes** only when ALL are true:

1. The **acceptance test(s)** (written in `explore`, red at first) now **pass**, unmodified.
2. `npx vitest run` → the **whole** suite green (the feature broke nothing).
3. `npx tsc --noEmit` → **0 errors**.
4. `npx eslint app lib components` → **no new** warnings vs. the run's start.

The red→green of the acceptance tests is the proof. No test = no spec = not done.

## Verification technique

**Acceptance testing** — the feature's acceptance criteria written as automated tests
*before* any product code changes. They fail on the current code (the feature doesn't exist
yet) and pass when it does. This matches what the pipeline produces: new user-facing
behavior, where "works" is defined by the ticket, not by the absence of an error. The
red-first step guards against tests that vacuously pass; the global gates guard regressions.

## Stages

`explore → plan → execute → eval`, each a separate agent; `execute` is the **maker**,
`eval` is a **separate verifier**. The difference from `bug-fix`:

- **explore = specify.** Read the ticket, locate the code the feature touches, and write
  the **acceptance test(s)** that encode the ticket's criteria. Confirm they are **red for
  the right reason** (the feature is missing), not a setup error.
- **plan** = the smallest build that satisfies the acceptance tests.
- **eval** runs those tests plus the full regression gates.

## Guardrails

- **Isolation:** run in a git worktree.
- **Data safety:** if the feature touches data, use a **Neon dev branch** — never prod,
  **never `seed:reset`**.
- **The test is the spec:** `execute` must not edit the acceptance tests to make them pass.
- **Bounds:** `max-iterations: 6`, `max-time: 60m`.
- **Escalate on ambiguity:** if the ticket's criteria are unclear, or the build needs a
  product/UX decision the ticket doesn't make, stop and hand back — don't invent behavior.

## How to run it

- Ticket lands in `orchestrator/inbox/` with `category: building`, `type: feature`.
- **First feature — by hand** to prove the specify→build→verify shape, then automate via
  `workflow.js`.
- Failures / surprises → [`../../memory/errors.md`](../../memory/errors.md).
