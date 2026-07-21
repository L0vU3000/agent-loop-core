# Stage 2 — Plan (read-only)

You are the Plan stage. Read `runs/<run-id>/explore.md`. Do not write the technical plan itself and
do not edit source. Write `runs/<run-id>/plan.md`.

## Write the plan

1. The **section outline** the technical plan must fill, bound to this request: architecture
   decision(s), file-by-file change list, layered touchpoints (data/schema, service, action, UI,
   tests, migration-if-needed), the ordered implementation sequence, rollback, risks, and open
   questions.
2. The **scope boundary** for one buildable slice — state explicitly what is deferred, so Execute
   cannot widen it beyond the approved scope.
3. The **layer map** the plan is expected to cover, taken from Explore: which of data/schema →
   service → action → UI → tests → migration this slice touches, and which it deliberately does
   not. This is the checklist Eval walks for completeness.
4. The **grounding list**: every real file/service/action/route/table the plan is expected to cite,
   and the closest sibling pattern each new file should mirror, so Eval can resolve each one.
5. The **downstream target**: the building `type` this plan resolves to, so the owner can hand the
   approved plan straight to that pipeline.
6. A task-specific **100-point Eval rubric** following [`../EVAL.md`](../EVAL.md). Weight the plan's
   highest-risk qualities most heavily and mark these critical:
   - **grounding** — every file/service/action/route/table cited resolves against real code, and
     every new file is justified against a real sibling (anti-hallucination);
   - **layer completeness** — nothing required to ship the slice is missing across data → service →
     action → UI → tests → migration;
   - **buildable sequencing** — steps are ordered and each depends only on earlier steps;
   - **boundedness** — one slice, explicit out-of-scope;
   - **constraint fidelity** — the plan honors `CLAUDE.md` (Neon + Drizzle, server-first, Zod, no
     Convex, no client secrets);
   - **honest open questions** — owner-only decisions are surfaced, not invented;
   - **complete sections** — the required section contract is present and non-empty.
   Set a pass threshold from 80–100 (use 85 unless the task argues otherwise).

Include the rubric under a `## Eval rubric` heading in the table shape `../EVAL.md` requires, with
whole-number weights totalling 100 and at least one critical criterion.

Hash the exact `## Eval rubric` section with SHA-256 and return `rubricReady`, `passThreshold`, and
`rubricSha256`. On a retry, keep the rubric byte-for-byte unchanged unless a human approved a
change. Return `rubricReady=true` and the `passThreshold` only when the scorecard totals 100 and
keeps every critical grounding, layer-completeness, and sequencing check.
