---
name: design-review
category: review
type: design-review
---

# Pipeline: design-review

> Reviews an existing product surface — a route or screen the ticket names — through a
> designer's eye and produces evidence-backed findings: visual inconsistency, spacing and
> hierarchy problems, accessibility gaps, and AI-slop patterns. It observes the surface; it does
> not restyle it. Every surviving finding is one the verifier could reproduce on the surface.

## Goal

Take a design-review ticket (an inbox item with `type: design-review` that names a target route
or surface) and produce one findings report for that surface: each finding carries a severity, a
precise location (the surface plus the specific element or region), the cited evidence that
proves it (a screenshot, the rendered element, or an accessibility check), and one sentence on
why it matters. For every confirmed high-severity finding, the run may also draft a downstream
building ticket so the owner can dispatch a fix — written `approved: false` so nothing is
restyled until the owner decides.

The deliverable is a document plus optional drafted tickets — never a product change. No source
file, stylesheet, component, schema, or database row is touched by this pipeline. The pipeline
may drive a headless browser to observe the surface, but it changes nothing it renders. Findings
are advisory: the owner decides what to fix.

## Scope gate

The ticket must name a real surface to review. Explore accepts only when the request points at a
route or screen that renders against the running app. It refuses and routes elsewhere when the
request is:

- a request to **build or restyle** a surface, not review it — route to a building pipeline
  (`feature`, `bug-fix`, `wiring`);
- a **correctness** review of a code change — route to `code-review`;
- a **security** audit for vulnerabilities — route to `security-review`;
- a **structure/boundaries** audit of the system's shape — route to `architecture-review`;
- a surface that does not render or has no visual content to observe — return it asking for a
  reachable route with real state.

## Exit condition

A run passes only when every check is true:

1. **Findings are verified.** The verifier independently reproduced every reported finding on the
   surface itself — re-rendered the route, located the same element, and re-confirmed the visual
   or accessibility defect; none survive on the maker's assertion alone.
2. **No false positives.** Any finding the verifier could not reproduce, or whose cited element
   does not exhibit the claimed problem, was dropped, not shipped. A hallucinated or
   unreproducible finding is a critical failure.
3. **Evidence is cited.** Every surviving finding names the surface and the specific element or
   region, and points at the proof — a screenshot, the rendered markup, or the accessibility
   check result — that a reader could re-observe. A finding without re-observable evidence fails.
4. **Severity is justified.** Each finding's severity follows the stated rubric — a blocking
   accessibility gap or a broken layout is high; a spacing-rhythm nit is low — and the report
   does not inflate taste into a defect.
5. **Declared scope was covered.** The review states which surface, states, and viewports it
   observed, and that stated scope matches the target the ticket named. A review that silently
   skips the mobile viewport or a key state fails.
6. **Findings are read-only and advisory.** The report proposes; it does not edit product code or
   styles. Any drafted fix ticket carries `approved: false` and names its downstream
   `category`/`type`.

The score reaches the Plan threshold with zero critical failures. The findings then go to the
owner, who decides which to route to a building pipeline. Design judgment stays with the owner.

## Verification technique

This pipeline uses **adversarial re-verification of every reported finding on the live surface**,
because the failure mode of an automated design reviewer is not missing a rough edge — it is
confidently reporting one that is not on the screen, or dressing personal taste as a defect. A
findings list nobody trusts is worse than none: it burns owner attention and trains the loop to
reward volume. So the anti-false-positive gate is the whole point.

A different-model, read-only verifier takes the maker's findings and, for each one, tries to
**disprove it**: it re-drives the surface itself — re-renders the route at the stated viewport
and state, locates the cited element, and re-observes the claimed spacing, hierarchy,
inconsistency, accessibility, or AI-slop problem. Any finding it cannot stand up on the surface
is **dropped** — it does not reach the owner. What the verifier grades objectively:

- **Findings verified** — each survivor was independently reproduced on the re-rendered surface.
- **No false positives (anti-hallucination)** — findings not observable on the surface were removed.
- **Evidence cited** — every survivor resolves to the surface plus a specific element and its
  screenshot or accessibility-check proof.
- **Severity justified** — the severity matches the rubric's definition, not the maker's emphasis.
- **Scope covered** — the declared surface, states, and viewports match the ticket's target.

The maker writes findings; the verifier confirms or drops each one and never adds its own or
edits the code or styles. The owner's judgment stays the final gate — which real findings are
worth fixing, and how to fix them, is a design call no pipeline should make.

Reference for the review's content shape: the installed `design-review` gstack skill (a
designer's-eye pass over a surface — visual inconsistency, spacing, hierarchy, accessibility, and
AI-slop patterns, driven through a headless browser) is the reviewing engine the maker follows,
used in observe-only mode. This pipeline adds the grounding, scoring, and maker≠verifier
discipline around it. This is distinct from `code-review` (correctness), `security-review`
(vulnerabilities), and `architecture-review` (structure).

## Stages

`explore → plan → execute → eval`. Each stage runs in a fresh context. Execute is the maker; Eval
is a different-model, read-only verifier.

- **Explore:** classify the request against the scope gate, confirm the target surface renders
  (the route is reachable and has real state to observe), and map the surface — the route, the
  component tree behind it, the states and viewports worth observing, and the standing design
  constraints the surface should honor (the project's Tailwind + shadcn/ui system, the
  fully-wired UI standard, the words-to-avoid AI-slop list). Record the review scope so Eval can
  check coverage.
- **Plan:** decide the review's scope boundaries (surface, states, viewports) and the severity
  definitions for this surface, name the downstream building type a confirmed high-severity
  finding would resolve to, and author the task-specific 100-point Eval rubric.
  Findings-verified, no-false-positives, evidence-cited, severity-justified, and scope-covered are
  critical criteria.
- **Execute (maker):** drive the surface over the declared scope with the `design-review` gstack
  skill in observe-only mode and write the findings report into `runs/<run-id>/`, plus any drafted
  `approved: false` fix tickets for confirmed high-severity findings. Capture screenshots and
  accessibility-check output as evidence. Do not edit product source, styles, or the live
  orchestrator inbox.
- **Eval (verifier):** independently re-verify every reported finding — re-render the surface,
  locate the cited element, re-observe the defect — drop any it cannot stand up, check severity
  and scope coverage, and score with cited evidence. On failure, return the scorecard to Plan.

## Guardrails

- **Read-only on the product.** This pipeline's only writes are the findings report, its
  screenshots, and any proposed fix tickets under `runs/<run-id>/`. It never edits source, styles,
  schema, migrations, seed data, or the live orchestrator inbox, and needs no worktree or database
  branch. Driving the browser is observe-only — it navigates and screenshots, it does not submit
  mutations. That makes it one of the safest pipelines; its risk is a false-positive finding,
  which the verifier and the human gate catch.
- **Human checkpoint.** The review category's default gate applies: the owner reviews the findings
  and decides which to act on. A drafted fix ticket is promoted from `runs/<run-id>/` to
  `agent-loop/orchestrator/inbox/` with `approved: true` only after the owner approves it. No
  building pipeline consumes an unapproved fix ticket.
- **Findings are advisory.** The pipeline reports; it does not restyle. A fix routes to a building
  ticket the owner approves — design judgment stays with the owner.
- **Bounds:** maximum 3 review attempts and a small agent-call cap per invocation; stop after the
  same verifier failure repeats twice.
- **Memory:** append failures and reusable lessons to `agent-loop/memory/errors.md`.

## Exit routing

A confirmed high-severity finding the owner accepts becomes exactly one building inbox ticket
(usually `feature` for a design-fix slice, sometimes `bug` for a broken-layout or blocking
accessibility defect). The pipeline does not fix it; it hands a precise, grounded ticket to the
orchestrator, which dispatches the matching building pipeline under that pipeline's own gates.
Low-severity nits may be batched or dropped at the owner's discretion.

## Status and trigger

Authored, not yet proven — the review category's design surface reviewer. Invoke `workflow.js`
with a `type: design-review` ticket path that names the target route or surface. Its proof waits
for a real surface to review; it must not be exercised on an unreachable or fabricated target.
