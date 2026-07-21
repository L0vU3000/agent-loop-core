---
name: spec
category: planning
type: spec
---

# Pipeline: spec

> Turns one unclear request into a precise, grounded, testable specification that a building
> pipeline can consume without inventing product scope. It plans the work; it does not build it.

## Goal

Take a vague intent (an inbox item with `type: spec`) and produce one bounded specification for
a single useful slice: the problem, explicit in- and out-of-scope boundaries, observable
acceptance criteria, the real code and data touchpoints the change will affect, risks, and the
open decisions only the owner can make. The run also drafts the downstream building ticket the
spec resolves to, so an approved spec can be dispatched without re-typing it.

The deliverable is a document plus a proposed ticket — never a product change. No source file,
schema, migration, or database row is touched by this pipeline.

## Scope gate

The ticket must carry a real intent to specify. Explore accepts only when the request is a
genuine, unspecified building need for this product. It refuses and routes elsewhere when the
request is:

- already precise enough to build — route straight to the matching building pipeline
  (`feature`, `bug-fix`, `entity`, `wiring`, `migration`, `api-tool`);
- a question about the world or the codebase with no change attached — route to `research`;
- a broad multi-slice initiative — return it asking the owner to name the first useful slice;
- a pure product or design judgment with no analyzable content — the owner decides, not a pipeline;
- something that **already exists** in the product. Explore must confirm the proposed capability
  or entity is not already built before specifying it (the lesson from the aborted `valuations`
  entity: a missing schema *filename* is not a missing feature — grep services, actions, and
  derivations, not just table names).

## Exit condition

A run passes only when every check is true:

1. The spec contains every required section: problem, in-scope, out-of-scope, acceptance
   criteria, affected surfaces/files, data and schema touchpoints, dependencies, risks, and
   open questions.
2. Every factual reference the spec makes — file path, service, table, route, action, or
   existing entity — **resolves against the current repository**. Eval collects this evidence
   itself with `graphify` and file reads; an unresolved or invented reference is a critical failure.
3. The proposed capability does **not already exist**. The spec states, with cited evidence,
   what it searched and why the slice is genuinely new (or, for a change to existing behavior,
   which real code it modifies).
4. Every acceptance criterion is **observable** — written so a downstream pipeline could turn it
   into a pass/fail check (a concrete user-visible outcome or a queryable state), never "works
   well" or "is fast".
5. In-scope and out-of-scope are both explicit; the slice is bounded, not an epic. No "and more"
   or open-ended widening.
6. Open decisions the owner must make are enumerated, not silently guessed. A spec that invents
   an answer to an unmade product decision fails.
7. The drafted downstream ticket names its target `category`/`type` and carries exactly the
   fields that pipeline's own scope gate requires (for an `entity`, the full field contract; for
   a `feature`, testable acceptance criteria). It is written with `approved: false` so it cannot
   be dispatched until the owner approves.
8. The spec respects the codebase's standing constraints (`CLAUDE.md`): Neon + Drizzle services,
   server-first components, Zod-validated mutations, no secrets to the client, no Convex.

The score reaches the Plan threshold with zero critical failures. The owner then approves the
spec's content before the drafted ticket is promoted to the inbox.

## Verification technique

This pipeline uses **independent spec review against a fixed evidence contract**, because its
product is a document, not code, and "good idea" is a matter of taste that no gate should
pretend to grade. What the verifier *can* grade objectively — and does — is whether the spec is
complete, grounded, testable, bounded, and honest:

- **Completeness** — the required section contract above is present and non-empty.
- **Grounding (anti-hallucination)** — the verifier resolves every reference itself with
  `graphify query`/`path`/`explain` and targeted reads. This is the criterion that would have
  caught a duplicate `valuations` entity: a spec that claims a gap must prove the gap.
- **Testability** — each acceptance criterion names an observable outcome a building pipeline's
  `eval` could assert.
- **Boundedness** — one useful slice, explicit out-of-scope, no epic creep.
- **Honesty** — unmade decisions appear under open questions rather than as invented answers.

The maker writes the spec; a different-model, read-only verifier scores it and never rewrites
it. The owner's approval remains the final gate for the content the pipeline cannot judge —
whether this is the right thing to build at all.

Reference for the spec's content shape: the installed `/spec` skill (turn vague intent into a
precise, executable spec) is the drafting engine the maker follows; this pipeline adds the
grounding, scoring, and maker≠verifier discipline around it.

## Stages

`explore → plan → execute → eval`. Each stage runs in a fresh context. Execute is the maker;
Eval is a different-model, read-only verifier.

- **Explore:** classify the request against the scope gate, confirm it is genuinely unspecified
  and not already built, and gather the real codebase context (existing patterns, affected
  surfaces, closest siblings) the spec must be grounded in. Record baselines only as needed to
  cite real references. Refuse fast on an out-of-scope request.
- **Plan:** decide the spec's structure and scope boundaries for this request, name the
  downstream building pipeline it will resolve to, and author the task-specific 100-point Eval
  rubric. Grounding, testable acceptance criteria, boundedness, no-duplicate, and honest open
  questions are critical criteria.
- **Execute (maker):** write the complete spec and the drafted `approved: false` downstream
  ticket into `runs/<run-id>/`. Do not edit product source, schema, or the live inbox.
- **Eval (verifier):** independently apply the rubric — resolve every reference, check each
  acceptance criterion is observable, confirm scope and no-duplicate — and score with cited
  evidence. On failure, return the scorecard to Plan.

## Guardrails

- **Read-only on the product.** This pipeline's only writes are the spec and proposed ticket
  under `runs/<run-id>/`. It never edits source, schema, migrations, seed data, or the live
  orchestrator inbox, and needs no worktree or database branch. That makes it the safest
  pipeline; its risk is a weak or scope-inventing spec, which Eval and the human gate catch.
- **Human checkpoint.** The planning category's default gate applies: the owner approves the
  spec's content before the drafted ticket is promoted from `runs/<run-id>/` to
  `agent-loop/orchestrator/inbox/` with `approved: true`. No building pipeline consumes an
  unapproved spec.
- **No invented scope.** A spec may not answer an owner-only product decision, widen beyond one
  slice, or assert a capability is new without cited proof.
- **Bounds:** maximum 3 spec attempts and a small agent-call cap per invocation; stop after the
  same verifier failure repeats twice.
- **Memory:** append failures and reusable lessons to `agent-loop/memory/errors.md`.

## Exit routing

An approved spec becomes exactly one building inbox ticket. The pipeline does not build it; it
hands a precise, grounded ticket to the orchestrator, which dispatches the matching building
pipeline under that pipeline's own gates.

## Status and trigger

Authored, not yet proven — the first planning pipeline. Invoke `workflow.js` with a
`type: spec` ticket path. Its proof waits for a real, unspecified building need; it must not be
exercised on an already-specified task or an invented one.
