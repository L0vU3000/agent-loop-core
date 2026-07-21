# Stage 2 — Plan (read-only)

You are the Plan stage. Read `runs/<run-id>/explore.md`. Do not write the findings report itself
and do not edit source. Write `runs/<run-id>/plan.md`.

## Write the plan

1. The **review scope** for this structure, bound to the ticket: the exact files and modules the
   maker must review, taken from Explore's resolved structure map. State explicitly what is out of
   scope (regions the subsystem does not include, pre-existing debt outside it) so the review
   neither skips the subsystem nor wanders across the whole repo.
2. The **finding shape** every finding must follow: `severity · location (file:line or module) ·
   cited evidence · why it matters`. Cited evidence names the exact `CLAUDE.md` rule the code
   violates or the dependency edge (from `graphify path`/`query`) that proves the coupling or cycle.
   Findings cover structural problems — layering violations, tight coupling, dependency cycles,
   drift from the architecture rules, and dead/parallel code — not line-level correctness, not
   vulnerabilities, not visual design.
3. The **severity definitions** for this structure, so severity is graded against a fixed bar and
   not the maker's emphasis. For example: **high** = a rule violation or dependency cycle with
   concrete blast radius — a component or route handler querying the database directly instead of
   through `lib/services/*`, business logic in a route handler, a client component importing a
   server secret, a live import into the dead Convex layer, or a cyclic dependency between modules;
   **medium** = a real coupling or drift with a narrow footprint; **low** = a mild structural smell
   with no rule broken.
4. The **downstream ticket shape**: the target building `type` a confirmed high-severity finding
   resolves to (usually `wiring` or `feature`, sometimes `bug`), and exactly which fields that
   pipeline's own scope gate requires. Execute drafts it with `approved: false`.
5. The **grounding list**: every real file/module and the specific `CLAUDE.md` rule or dependency
   edge the review is expected to cite, taken from Explore, so Eval can resolve each finding's
   location and violation.
6. A task-specific **100-point Eval rubric** following [`../EVAL.md`](../EVAL.md). Weight the
   review's highest-risk qualities most heavily and mark these critical:
   - **findings verified** — every reported finding was independently re-verified (its dependency
     edge traced or its rule violation re-confirmed);
   - **no false positives** — anti-hallucination; any unsubstantiated or misread finding is dropped,
     never shipped;
   - **evidence cited** — every finding resolves to a real `file:line` or module and names the exact
     rule or dependency edge it violates;
   - **severity justified** — each severity matches the stated definitions;
   - **scope covered** — the declared review scope matches the subsystem actually under review;
   - a **valid drafted ticket** for any confirmed high-severity finding.
   Set a pass threshold from 80–100 (use 85 unless the task argues otherwise).

Hash the exact `## Eval rubric` section with SHA-256 and return `rubricReady`, `passThreshold`,
and `rubricSha256`. On a retry, keep the rubric byte-for-byte unchanged unless a human approved a
change. Return `rubricReady=true` and the `passThreshold` only when the scorecard totals 100 and
keeps every critical verification/evidence/severity/scope check.
