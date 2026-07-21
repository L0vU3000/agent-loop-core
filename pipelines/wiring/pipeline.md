---
name: wiring
category: building
type: wiring
---

# Pipeline: wiring

> **Building pipeline — make what's shown real.** Takes one named surface that displays
> mock, placeholder, or hardcoded values and replaces every in-scope value with real data
> wired from the Neon (Drizzle) services layer (`lib/services/*`) through Server Actions and
> Server Components. The product's UI Design Standard is the contract: every displayed value
> must trace to a real schema field or a named derivation — no UI-only invented state. The
> sibling of `feature`: same four stages, same rigor. The difference is that `explore` pins
> each shown value to a **real backing field** with a red assertion, instead of specifying
> new behavior.

## Goal

Every mock, placeholder, or hardcoded value on the named surface is replaced by real data
that traces to a schema field or a named derivation, **and** the assertion that pins each
value to its backing field is green and stays in the suite so the surface can't silently
drift back to fake data.

## Scope gate (accept / refuse)

Accept **only** a surface whose fake values have a real backing field or derivation that
already exists. Refuse and route elsewhere when:

- The data does not exist yet (no schema field, no derivable source) → route to `entity` or
  `migration`. Wiring does not invent schema.
- The value needs new product behavior or a UX decision the surface doesn't already make →
  route to `feature`.

Refusal is a valid, fast outcome. Wire what has a home; hand back what doesn't.

## Exit condition (the check)

A run **passes** only when ALL are true:

1. **Every in-scope value traces** to a real schema field or a named derivation — the
   verifier cites the field (or derivation function) for each value.
2. **No mock, placeholder, or hardcoded value remains** in scope on the surface.
3. The **traceability assertion(s)** (written in `explore`, red at first) now **pass**,
   unmodified, and the surface renders with real data.
4. `npx vitest run` → the **whole** suite green (the wiring broke nothing).
5. `npx tsc --noEmit` → **0 errors**.
6. `npx eslint app lib components` → **no new** warnings vs. the run's start.

The red→green of the traceability assertion is the proof. No assertion = no pin = not done.

## Verification technique

**Value-traceability checking** — before any product code changes, `explore` writes a focused
assertion that pins each in-scope value to the real schema field or derivation it should read
from. The assertion is **red now** because the surface renders a mock/placeholder/hardcoded
literal instead of the backing value; it goes **green** once the value is wired. This matches
what the pipeline produces: the same rendered surface, now sourced from real data rather than
new behavior. Independently, the verifier confirms *every* value in scope traces to a cited
field, that no fake value survives, and that the surface renders — then runs the global
regression gates. The red-first step guards against assertions that vacuously pass; the
traceability + no-remaining-mocks checks guard against a surface that looks wired but still
carries invented state.

## Stages

`explore → plan → execute → eval`, each a separate agent; `execute` is the **maker**,
`eval` is a **separate verifier**. The difference from `feature`:

- **explore = pin.** Read the surface, list every mock/placeholder/hardcoded value, and for
  each find the real backing field or derivation. Apply the scope gate — refuse anything with
  no data home. Write the **traceability assertion(s)** and confirm they are **red for the
  right reason** (the surface renders a literal, not the real value), not a setup error.
- **plan** = the smallest wiring that turns every red assertion green, reusing existing
  services/actions.
- **eval** confirms traceability + no-remaining-mocks + surface-renders, then runs the full
  regression gates.

## Guardrails

- **Isolation:** run in a git worktree (the maker edits component ↔ service/action wiring).
- **Data safety:** wire reads through the **Neon dev branch** — never prod, **never
  `seed:reset`** (it destroys evolved seed data).
- **The assertion is the pin:** `execute` must not edit the traceability assertions to make
  them pass.
- **No new schema:** wiring reads existing fields/derivations only. If a value needs a field
  that doesn't exist, stop and route to `entity`/`migration`.
- **Bounds:** `max-iterations: 6`, `max-time: 60m`.
- **Escalate on ambiguity:** if a value has no clear backing field, or picking one needs a
  product decision, stop and hand back — don't invent a source.

## How to run it

- Ticket lands in `orchestrator/inbox/` with `category: building`, `type: wiring`, naming the
  one surface in scope.
- **First run — by hand** to prove the pin→wire→verify shape, then automate via `workflow.js`.
- Failures / surprises → [`../../memory/errors.md`](../../memory/errors.md).
