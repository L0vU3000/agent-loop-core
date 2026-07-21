---
name: bug-fix
category: building
type: bug
---

# Pipeline: bug-fix

> **Pipeline #2 — the real payoff.** Takes a bug ticket, reproduces it with a *failing test*,
> fixes the root cause, and leaves a regression test guarding it. Higher stakes than
> eslint-burndown, so the verification is stronger: the check is a **test that goes red → green**.

## Goal

The reported bug no longer happens, **and** a new automated test captures it so it can't
silently return.

## Exit condition (the check)

A run **passes** only when ALL are true:

1. The **new regression test** (written in `explore`, red at first) now **passes**.
2. `npx vitest run` → the **whole** suite green (no collateral breakage).
3. `npx tsc --noEmit` → **0 errors**.
4. `npx eslint app lib components` → **no new** warnings vs. the run's start.

The red→green of the new test is the proof. No new test = not done — a fix you can't
re-verify isn't a fix.

## Stages

`explore → plan → execute → eval`, each a separate agent; `execute` is the **maker**,
`eval` is a **separate verifier**. The difference from eslint-burndown:

- **explore = reproduce.** Find the broken behavior, write a **failing test** that captures
  it, and locate the root cause. If it can't be reproduced, stop and report — never "fix"
  a bug you can't demonstrate.
- **eval** runs that new test plus the full regression gates.

## Guardrails

- **Isolation:** run in a git worktree.
- **Data safety:** if the bug touches data, use a **Neon dev branch** — never prod, **never
  `seed:reset`**.
- **Root cause, not symptom:** fix the cause the reproduction exposes; don't paper over it.
- **Bounds:** `max-iterations: 6`, `max-time: 60m`.
- **Escalate on ambiguity:** if the root cause is unclear or the fix needs a product decision,
  stop and hand back — don't guess on user-facing behavior.

## How to run it

- Ticket lands in `orchestrator/inbox/` with `type: bug`.
- **First bug — by hand** to prove the reproduce→fix→guard shape, then automate via `workflow.js`.
- Failures / surprises → [`../../memory/errors.md`](../../memory/errors.md).
