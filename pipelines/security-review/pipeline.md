---
name: security-review
category: review
type: security-review
---

# Pipeline: security-review

> Reviews an existing change — a branch, a diff, or a PR — for security vulnerabilities against
> this repository's own security rules, and produces evidence-backed findings: each names the
> exact vulnerable code and the concrete exploit it enables. It inspects the change for authorized
> defensive review of this codebase only; it does not fix it. Every surviving finding is one the
> verifier could stand up.

## Goal

Take a security-review ticket (an inbox item with `type: security-review` that names a target
branch, diff, or PR) and produce one vulnerability findings report for that change. Each finding
carries a severity, a precise location (`file:line`), the cited vulnerable code, the concrete
exploit or impact it enables, and one sentence on why it matters. For every confirmed
high-severity finding, the run may also draft a downstream building ticket so the owner can
dispatch a fix — written `approved: false` so nothing is fixed until the owner decides.

The deliverable is a document plus optional drafted tickets — never a product change. No source
file, schema, migration, or database row is touched by this pipeline. Findings are advisory: the
owner decides what to fix. This pipeline performs authorized defensive review of the Valgate
codebase; it never produces a working exploit for use elsewhere.

## What it looks for

The bar is this repository's standing security rules (`CLAUDE.md` → Security Rules). The maker
hunts the change for:

- **Missing authentication or authorization** — a mutation or data read that does not verify who
  the caller is, or does not verify the caller may act on this resource.
- **IDOR / missing ownership check** — a resource fetched or mutated by id without confirming it
  belongs to the current user or org (the classic authz-without-ownership hole).
- **Unvalidated input reaching the DB** — raw `FormData` or request input reaching a Drizzle
  query without a Zod parse first.
- **Error leakage** — `err.message` (or a raw error object) returned to the client instead of a
  logged-internally, generic client string.
- **Secret exposure** — a secret prefixed with `NEXT_PUBLIC_`, or a secret/full credential passed
  as a prop into a Client Component.
- **Missing rate limiting** — login, signup, or another sensitive action with no rate limit.
- **Over-exposure to the client** — a full DB object sent as props where the UI needs only a few
  selected fields.

## Scope gate

The ticket must name a real change to review. Explore accepts only when the request points at an
existing branch/diff/PR whose contents resolve against the repository. It refuses and routes
elsewhere when the request is:

- a request to **write or fix** code, not review it — route to a building pipeline (`feature`,
  `bug-fix`, `entity`, `wiring`);
- a **correctness** review for wrong-output/crash bugs and cleanups — route to `code-review`;
- a **structure/boundaries** audit of the system's shape — route to `architecture-review`;
- a **design/visual** critique of a surface — route to `design-review`;
- an empty or already-merged-and-verified target with no diff to inspect — return it asking for a
  real change set;
- a request to attack, penetrate, or exfiltrate from a system that is not this codebase, or to
  produce a reusable exploit rather than a defensive finding — refuse; this pipeline reviews the
  Valgate codebase for its own defense.

## Exit condition

A run passes only when every check is true:

1. **Findings are verified.** The verifier independently confirmed every reported vulnerability
   against the current code — it traced the unauthorized path or re-confirmed the missing check;
   none survive on the maker's assertion alone.
2. **No false positives.** Any finding the verifier could not stand up — the "missing" check
   turns out to exist upstream, the input is already Zod-validated, the value is not actually a
   secret — was dropped, not shipped. A hallucinated or unreproducible vulnerability is a critical
   failure.
3. **Evidence is cited.** Every surviving finding names a real `file:line`, quotes the exact
   vulnerable code, and states the concrete exploit or impact (the request an attacker sends, the
   data they reach). A finding without resolvable evidence fails.
4. **Severity is justified.** Each finding's severity follows the stated rubric — an exploitable
   authz/IDOR/secret-exposure hole with a concrete attack path is high; a defense-in-depth gap
   with no reachable exploit is lower — and the report does not inflate a hardening suggestion into
   a live vulnerability.
5. **Declared scope was covered.** The review states which files/hunks of the change it examined
   against which security rules, and that stated scope matches the target's actual diff. A review
   that silently skips half the change fails.
6. **Findings are read-only and advisory.** The report proposes; it does not edit product code or
   produce a weaponized exploit. Any drafted fix ticket carries `approved: false` and names its
   downstream `category`/`type`.

The score reaches the Plan threshold with zero critical failures. The findings then go to the
owner, who decides which to route to a building pipeline.

## Verification technique

This pipeline uses **adversarial re-verification of every reported vulnerability**, because the
failure mode of an automated security reviewer is not a missed hole — it is confidently reporting
one that is not real. A security findings list nobody trusts is worse than none: it burns owner
attention, cries wolf, and trains the loop to reward volume over truth. So the anti-false-positive
gate is the whole point and the exit condition.

A different-model, read-only verifier takes the maker's findings and, for each one, tries to
**disprove it**: it independently traces the unauthorized path (which caller, which resource id,
which missing check) or re-reads the cited `file:line` to confirm the vulnerable code actually
says what the finding claims — and checks that the guard the finding says is missing is not
present upstream (a shared `requireOwner` helper, a Zod parse in the action, a `select` that never
exposes the field). Any finding it cannot stand up is **dropped** — it does not reach the owner.
What the verifier grades objectively:

- **Findings verified** — each survivor's vulnerable path was independently traced or its cited
  code re-confirmed.
- **No false positives (anti-hallucination)** — findings whose "missing" guard exists, whose input
  is already validated, or whose value is not a secret were removed.
- **Evidence cited** — every survivor resolves to a real location with quoted vulnerable code and a
  concrete exploit/impact.
- **Severity justified** — the severity matches the rubric's definition (reachable exploit vs.
  hardening gap), not the maker's emphasis.
- **Scope covered** — the declared review scope and rule coverage match the target's actual diff.

The maker writes findings; the verifier confirms or drops each one and never adds its own or edits
the code. The owner's judgment stays the final gate — which real vulnerabilities are worth fixing,
and in what order, is a product call no pipeline should make.

Reference for the review's content shape: the installed `/cso` (Chief Security Officer mode) and
`/security-review` skills are the reviewing engines the maker follows; this pipeline adds the
grounding, scoring, and maker≠verifier discipline around them. This is distinct from `code-review`
(correctness bugs and cleanups), `architecture-review` (structure and boundaries), and
`design-review` (visual and UX).

## Stages

`explore → plan → execute → eval`. Each stage runs in a fresh context. Execute is the maker; Eval
is a different-model, read-only verifier.

- **Explore:** classify the request against the scope gate, confirm the target change resolves
  (branch/diff/PR exists and has a real diff), and map the change against the attack surface — the
  mutations, data reads, actions, client props, and env usage the change touches, and the standing
  `CLAUDE.md` security rules each must satisfy. Record the review scope so Eval can check coverage.
- **Plan:** decide the review's scope boundaries, which security rules apply to this change, and
  the severity definitions, name the downstream building type a confirmed high-severity finding
  would resolve to, and author the task-specific 100-point Eval rubric. Findings-verified,
  no-false-positives, evidence-cited, severity-justified, and scope-covered are critical criteria.
- **Execute (maker):** run the security review over the declared scope with `/cso` and
  `/security-review`, and write the findings report into `runs/<run-id>/`, plus any drafted
  `approved: false` fix tickets for confirmed high-severity findings. Do not edit product source,
  schema, or the live orchestrator inbox, and do not write a reusable exploit.
- **Eval (verifier):** independently re-verify every reported vulnerability — trace its path or
  re-confirm its cited code and that no upstream guard already covers it — drop any it cannot
  stand up, check severity and scope coverage, and score with cited evidence. On failure, return
  the scorecard to Plan.

## Guardrails

- **Read-only on the product.** This pipeline's only writes are the findings report and any
  proposed fix tickets under `runs/<run-id>/`. It never edits source, schema, migrations, seed
  data, or the live orchestrator inbox, and needs no worktree or database branch. That makes it
  one of the safest pipelines; its risk is a false-positive finding, which the verifier and the
  human gate catch.
- **Defensive only.** The pipeline reviews the Valgate codebase for its own security. It documents
  a vulnerability and its impact so the owner can close it; it does not produce a working exploit,
  test against live production, or touch any system other than this repository.
- **Human checkpoint.** The review category's default gate applies: the owner reviews the findings
  and decides which to act on. A drafted fix ticket is promoted from `runs/<run-id>/` to
  `agent-loop/orchestrator/inbox/` with `approved: true` only after the owner approves it. No
  building pipeline consumes an unapproved fix ticket.
- **Findings are advisory.** The pipeline reports; it does not fix. A fix routes to a building
  ticket the owner approves — product and security judgment stays with the owner.
- **Bounds:** maximum 3 review attempts and a small agent-call cap per invocation; stop after the
  same verifier failure repeats twice.
- **Memory:** append failures and reusable lessons to `agent-loop/memory/errors.md`.

## Exit routing

A confirmed high-severity vulnerability the owner accepts becomes exactly one building inbox
ticket (usually `bug` for a fix, sometimes `feature` for a missing control such as rate limiting).
The pipeline does not fix it; it hands a precise, grounded ticket to the orchestrator, which
dispatches the matching building pipeline under that pipeline's own gates. Lower-severity hardening
gaps may be batched or deferred at the owner's discretion.

## Status and trigger

Authored, not yet proven — a review-category pipeline alongside `code-review`. Invoke `workflow.js`
with a `type: security-review` ticket path that names the target branch, diff, or PR. Its proof
waits for a real change to review; it must not be exercised on an empty or fabricated target.
