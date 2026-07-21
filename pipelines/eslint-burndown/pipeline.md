---
name: eslint-burndown
category: maintenance
type: lint
---

# Pipeline: eslint-burndown

> **Training-wheels pipeline #1.** Drains ESLint warnings toward zero. Chosen because the
> check is airtight and the stakes are near-zero — the real product is a *trusted loop*,
> not the fixes. See [decision](../../memory/decisions.md).

## Goal

`eslint app lib components` reports **0 warnings** — or every remaining warning is
explicitly documented as intentional (e.g. an `_`-prefixed unused param).

## Exit condition (the check — this is what makes it a loop)

A run **passes** only when ALL are true:

1. `npx eslint app lib components` warning count is **strictly lower** than the run started with.
2. `npx tsc --noEmit` → still **0 errors** (no regression).
3. `npx vitest run` → still **green** (no regression).

The loop stops when warnings hit 0 (or all-intentional), or on `max-iterations` / `max-time`.

## Stages

`explore → plan → execute → eval` — see each `*.md` in this folder. `execute` is the
**maker**, `eval` is a **separate verifier**.

## Guardrails

- **Isolation:** run in a git worktree; this pipeline edits code only. **No DB access** —
  lint fixes never touch Neon.
- **Bounds:** `max-iterations: 8`, `max-time: 45m` (tune after the first real run).
- **Scope:** only `@typescript-eslint/no-unused-vars`-class and other warnings surfaced by
  the lint command. Do **not** refactor logic to satisfy a warning — if a fix isn't
  mechanical, kick it back as a note, don't guess.

## How to run it

- **First time — by hand** (prove the loop closes): step through the four stages yourself,
  watch `eval` go red then green. This is the "do it by hand first" rule.
- **Then — automated:** run `execute ↔ eval` as a built-in **`Workflow`** — `execute` and
  `eval` are separate `agent()` calls, looping until `eval` returns pass. The eval agent runs
  the shell check `npx eslint app lib components` and follows [`eval.md`](./eval.md). (Built-in
  only — no external tools, so this keeps working regardless of what else is installed.)
- Failures → log the lesson in [`../../memory/errors.md`](../../memory/errors.md).
