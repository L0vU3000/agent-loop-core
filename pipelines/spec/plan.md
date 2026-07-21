# Stage 2 — Plan (read-only)

You are the Plan stage. Read `runs/<run-id>/explore.md`. Do not write the specification itself
and do not edit source. Write `runs/<run-id>/plan.md`.

## Write the plan

1. The **section outline** the spec must fill, bound to this request: problem, in-scope,
   out-of-scope, acceptance criteria, affected surfaces/files, data and schema touchpoints,
   dependencies, risks, and open questions.
2. The **scope boundary** for one useful slice — state explicitly what is deferred, so Execute
   cannot widen it.
3. The **downstream ticket shape**: the target building `type`, and exactly which fields that
   pipeline's own scope gate requires (for an `entity`, the full field contract; for a `feature`,
   testable acceptance criteria). Execute drafts it with `approved: false`.
4. The **grounding list**: every real file/service/route/table the spec is expected to cite, taken
   from Explore, so Eval can resolve each one.
5. A task-specific **100-point Eval rubric** following [`../EVAL.md`](../EVAL.md). Weight the
   spec's highest-risk qualities most heavily and mark these critical:
   - **grounding** — every reference resolves against real code (anti-hallucination);
   - **testable acceptance criteria** — each is an observable outcome;
   - **boundedness** — one slice, explicit out-of-scope;
   - **not a duplicate** — the capability is proven genuinely new (or names the real code it changes);
   - **honest open questions** — unmade owner decisions are surfaced, not invented;
   - **complete sections** and a **valid drafted ticket**.
   Set a pass threshold from 80–100 (use 85 unless the task argues otherwise).

Hash the exact `## Eval rubric` section with SHA-256 and return `rubricReady`, `passThreshold`,
and `rubricSha256`. On a retry, keep the rubric byte-for-byte unchanged unless a human approved a
change. Return `rubricReady=true` and the `passThreshold` only when the scorecard totals 100 and
keeps every critical grounding/testability/scope check.
