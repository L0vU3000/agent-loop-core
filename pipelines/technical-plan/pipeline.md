---
name: technical-plan
category: planning
type: technical-plan
---

# Pipeline: technical-plan

> Turns one already-approved scope or spec into a precise, grounded technical implementation plan
> that a building pipeline can execute without inventing architecture. It decides the HOW — one
> layer deeper than `spec`'s WHAT. It plans the work; it does not build it.

## Goal

Take an approved spec or a well-scoped need (an inbox item with `type: technical-plan`) and produce
one buildable implementation plan for a single slice: the architecture decision(s), a file-by-file
change list where every entry is a real existing path or a justified new one, the layers the change
touches (data/schema, service, action, UI, tests, and a migration when the schema moves), the
ordered implementation sequence, rollback, and the risks and open decisions the owner still owns.

The deliverable is a document — `runs/<run-id>/technical-plan.md`. No source file, schema,
migration, seed row, or database branch is touched by this pipeline. A building pipeline consumes
the approved plan and does the actual work under its own gates.

## Scope gate

The ticket must carry an approved WHAT that needs a technical HOW. Explore accepts only when the
scope is settled and what remains is the engineering plan. It refuses and routes elsewhere when the
request is:

- still undecided on scope, boundaries, or acceptance — route to `spec`, which decides WHAT/WHY;
- a question about the world or the codebase with no change attached — route to `research`;
- already precise enough to build as-is, with the architecture obvious — route straight to the
  matching building pipeline (`feature`, `bug-fix`, `entity`, `wiring`, `migration`, `api-tool`);
- a broad multi-slice initiative — return it asking the owner to name the first buildable slice;
- a pure product or design judgment with no analyzable engineering content — the owner decides.

A `type: technical-plan` ticket may reference a `spec` pipeline's approved output; that spec's
in-scope, out-of-scope, and acceptance criteria are the fixed frame this plan turns into a build.

## How this differs from its planning siblings

- `spec` decides **WHAT and WHY** — the problem, the bounded scope, observable acceptance criteria.
- `technical-plan` decides **HOW** — architecture, file-by-file changes, layers, and build order.
- `research` answers a **question** and attaches no change.

`technical-plan` consumes a spec's output; it never re-opens the scope decision the spec settled.

## Exit condition

A run passes only when every check is true:

1. The plan contains every required section: architecture decision(s), file-by-file change list,
   layered touchpoints (data/schema, service, action, UI, tests, migration-if-needed), the ordered
   implementation sequence, rollback, risks, and open questions.
2. Every reference the plan makes — file path, service, action, route, table, column, or existing
   entity — **resolves against the current repository**, and every new file it proposes is
   justified against a real sibling pattern. Eval collects this evidence itself with `graphify` and
   file reads; an unresolved or invented reference is a critical failure.
3. The plan is **complete across layers**: nothing required to ship the slice is missing. If a
   mutation is added, its Zod validation, service query, action, UI wiring, and tests all appear;
   if the schema moves, a migration step appears.
4. The implementation sequence is **ordered and buildable** — each step depends only on steps
   before it, and a builder could follow them top to bottom without back-tracking.
5. In-scope and out-of-scope are both explicit; the plan covers one slice, not an epic. No
   "and more" or open-ended widening.
6. The plan respects the codebase's standing constraints (`CLAUDE.md`): Neon + Drizzle services,
   server-first components, Zod-validated mutations, no secrets to the client, no Convex.
7. Open decisions the owner must make (a library choice, a data-model trade-off, a UX call) are
   enumerated as open questions, not silently answered. A plan that invents an owner-only decision
   fails.

The score reaches the Plan threshold with zero critical failures. The owner then approves the
plan's architecture and sequence before it is handed to a building pipeline.

## Verification technique

This pipeline uses **independent plan review against a grounded-buildability contract**, because
its product is an engineering plan, not code, and "good architecture" is partly a matter of taste
that no gate should pretend to grade. What the verifier *can* grade objectively — and does — is
whether the plan is grounded, complete, sequenced, bounded, and honest:

- **Grounding (anti-hallucination)** — the verifier resolves every file, service, action, route,
  and table the plan cites, itself, with `graphify query`/`path`/`explain` and targeted reads. A
  plan that instructs a builder to edit a file or call a service that does not exist is worse than
  no plan; this is the critical check.
- **Layer completeness** — the verifier walks the data → service → action → UI → tests → migration
  chain and confirms nothing required to ship the slice is missing.
- **Buildable sequencing** — each ordered step depends only on earlier steps; a builder could
  execute them top to bottom.
- **Boundedness** — one slice, explicit out-of-scope, no epic creep.
- **Constraint fidelity** — the plan honors `CLAUDE.md` (Neon + Drizzle, server-first, Zod, no
  Convex, no client secrets).
- **Honesty** — owner-only decisions appear under open questions rather than as invented answers.

The maker writes the plan; a different-model, read-only verifier scores it and never rewrites it.
The owner's approval remains the final gate for the judgment the pipeline cannot grade — whether
this is the right architecture to commit to.

Reference for the plan's content shape: the installed `/plan` skill (design an implementation
strategy) is the drafting engine the maker follows, and `/spec` frames the WHAT it starts from;
this pipeline adds the grounding, scoring, and maker≠verifier discipline around it.

## Stages

`explore → plan → execute → eval`. Each stage runs in a fresh context. Execute is the maker;
Eval is a different-model, read-only verifier.

- **Explore:** classify the request against the scope gate, confirm the scope is already approved
  and what remains is the engineering plan, and gather the real codebase context (existing
  patterns, the closest sibling change, affected surfaces, the layers involved) the plan must be
  grounded in. Refuse fast on an out-of-scope request.
- **Plan:** decide the plan's structure and scope boundaries for this request, name the downstream
  building pipeline it will resolve to, and author the task-specific 100-point Eval rubric.
  Grounding, layer completeness, buildable sequencing, boundedness, constraint fidelity, and honest
  open questions are critical criteria.
- **Execute (maker):** write the complete technical plan into `runs/<run-id>/technical-plan.md`.
  Do not edit product source, schema, migrations, seed data, the database, or the live inbox.
- **Eval (verifier):** independently apply the rubric — resolve every reference, walk the layers,
  check the sequence is buildable, confirm scope and constraints — and score with cited evidence.
  On failure, return the scorecard to Plan.

## Guardrails

- **Read-only on the product.** This pipeline's only write is the technical plan under
  `runs/<run-id>/`. It never edits source, schema, migrations, seed data, the database, or the live
  orchestrator inbox, and needs no worktree or database branch. That makes it a safe pipeline; its
  risk is a weak or hallucinated plan, which Eval's grounding check and the human gate catch.
- **Human checkpoint.** The planning category's default gate applies: the owner approves the plan's
  architecture and sequence before it is handed to a building pipeline. No building pipeline
  executes an unapproved technical plan.
- **No invented architecture.** A plan may not answer an owner-only decision, widen beyond one
  slice, or cite a file, service, or table it did not confirm exists.
- **Bounds:** maximum 3 plan attempts and a small agent-call cap per invocation; stop after the
  same verifier failure repeats twice.
- **Memory:** append failures and reusable lessons to `agent-loop/memory/errors.md`.

## Exit routing

An approved technical plan feeds exactly one building slice. The pipeline does not build it; it
hands a grounded, sequenced plan to the owner, who dispatches the matching building pipeline under
that pipeline's own gates.

## Status and trigger

Authored, not yet proven. Invoke `workflow.js` with a `type: technical-plan` ticket path that
references an approved spec or a settled scope. Its proof waits for a real, approved slice that
needs its HOW planned; it must not be exercised on an unscoped request or an invented one.
