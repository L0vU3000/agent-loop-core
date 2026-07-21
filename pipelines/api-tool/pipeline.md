---
name: api-tool
category: building
type: api-tool
---

# Pipeline: api-tool

> **Expose one already-built behavior over the tool surface.** Takes a ticket that asks for a
> single new MCP tool (or API endpoint) and wires it as a **thin wrapper** over an *existing*
> `lib/services/*` function through the established `ctxFor()` seam. It writes the tool
> definition and its registration — nothing else. It adds **no new product behavior and no
> schema**: if the underlying service does not exist yet, this pipeline refuses and routes the
> work to `feature`, `entity-scaffold`, or `migration` first.

## Goal

A new tool exists on the external surface that calls a real `lib/services/*` function through
`ctxFor()`, validates its input with Zod, inherits the service's authorization, hides internal
errors, and proves itself with a focused end-to-end test — with the global gates still green.

## Exit condition (the check)

A run **passes** only when ALL are true:

1. The **tool test** (written in `explore`, red at first because the tool is absent) now
   **passes**, unmodified — it drives the tool end-to-end against the real service.
2. The tool resolves its caller through **`ctxFor()`** and calls an **existing** service
   function — it re-implements no business logic and adds no schema.
3. **Input is validated with Zod** before the service is touched; malformed input is refused.
4. **Authorization is enforced**: a cross-tenant / wrong-org call is rejected (the service's
   own org-scope and role guards run — they are not bypassed or re-implemented).
5. **No internal error leaks**: the tool returns a generic client message and logs the detail
   internally; raw `err.message` never reaches the caller.
6. `npx vitest run` → the **whole** suite green.
7. `npx tsc --noEmit` → **0 errors**.
8. `npx eslint app lib components mcp-server` → **no new** warnings vs. the run's start.

The red→green of the tool test is the proof, and the authorization + validation + no-leak
checks are what make an external surface safe to ship.

## Verification technique

**End-to-end surface testing with an adversarial authorization probe.** The tool is exercised
the way a caller reaches it — through `ctxFor()` into the real service — so "works" means the
whole path runs, not that a mock returned a value. Three probes make the surface trustworthy:
a **happy-path call** returns the service's result; a **cross-tenant call** is rejected (proves
the wrapper did not widen the service's authorization); a **malformed-input call** is refused by
the Zod schema before any DB work. This matches what the pipeline produces — an external
entry point over existing behavior — where the risk is not "is the feature built" (it already
is) but "did exposing it open a hole".

## Stages

`explore → plan → execute → eval`, each a separate agent; `execute` is the **maker**, `eval`
is a **separate verifier**.

- **explore = ground + specify.** Confirm the target `lib/services/*` function already exists
  and read how its siblings are wrapped (`mcp-server/register.ts`, `writes.ts`, `ctxFor.ts`).
  Write the failing **tool test** (happy path + cross-tenant rejection + malformed-input
  rejection). If the service does **not** exist, stop and route to `feature`/`entity`/
  `migration`.
- **plan** = the smallest wiring that satisfies the tool test, reusing the site's existing
  Zod schema and the shared `getCtx`/`resolveWriteCtx` helpers. Plan also writes the
  100-point rubric.
- **execute** = add the tool definition + registration only.
- **eval** runs the tool test plus the authorization, validation, no-leak, and regression
  gates.

## Guardrails

- **Isolation:** run in a git worktree.
- **Data safety:** if the wrapped service touches data, exercise it against a **Neon dev
  branch** — never prod, **never `seed:reset`**.
- **No new behavior:** the tool is a wrapper. No new business logic, no schema, no migration.
  Refuse and route out if the service is missing.
- **Reuse authorization, never re-implement it:** the tool must let the service's own
  org-scope, role, and demo read-only guards run through `ctxFor()`. Writes resolve their Ctx
  with `requireExplicitOrg=true` so a multi-org caller must name the org.
- **The test is the spec:** `execute` must not edit the tool test to make it pass.
- **Bounds:** `max-iterations: 6`, `max-time: 60m`.
- **Memory:** failures / surprises → [`../../memory/errors.md`](../../memory/errors.md).
- **Escalate on ambiguity:** if the ticket needs a product decision, or the intended service
  behavior is unclear, stop and hand back — don't invent it on the surface.

## Rubric guidance

Weight the rubric so an unsafe surface can never pass on a high total. These are **critical**
criteria — failing any one fails the run regardless of score:

- **Authorization enforced** — the cross-tenant probe is rejected through the service's guards.
- **Input validated** — the Zod schema refuses malformed input before the DB is touched.
- **No error leakage** — no raw `err.message` reaches the caller; details are logged internally.
- **Tool works end-to-end** through `ctxFor()` against the real service (red→green).
- **Global gates** — vitest suite, `tsc`, and no new ESLint warnings.

## How to run it

- Ticket lands in `orchestrator/inbox/` with `category: building`, `type: api-tool`, naming
  the service function to expose and the caller-facing shape.
- **First run — by hand** to prove the wrap→probe→verify shape, then automate via
  `workflow.js`.
