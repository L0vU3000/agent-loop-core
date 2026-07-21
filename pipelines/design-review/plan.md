# Stage 2 — Plan (read-only)

You are the Plan stage. Read `runs/<run-id>/explore.md`. Do not write the findings report itself
and do not edit source or styles. Write `runs/<run-id>/plan.md`.

## Write the plan

1. The **review scope** for this surface, bound to the ticket: the exact surface, states
   (loading, empty, populated, error), and viewports (at least mobile and desktop) the maker must
   observe, taken from Explore's resolved surface map. State explicitly what is out of scope
   (other routes, states not reachable with the seed data) so the review neither skips the target
   nor wanders across the whole app.
2. The **finding shape** every finding must follow: `severity · location (surface + specific
   element/region) · cited evidence (screenshot or accessibility-check result) · why it matters`.
   Findings cover visual inconsistency, spacing and hierarchy problems, accessibility gaps, and
   AI-slop patterns — this is not a correctness, security, or architecture review.
3. The **severity definitions** for this surface, so severity is graded against a fixed bar and
   not the maker's taste. For example: **high** = a blocking accessibility gap (unreadable
   contrast, no keyboard path, missing label on a control), a broken or overflowing layout, or
   content that is illegible or lost at a supported viewport; **medium** = a real inconsistency
   with the design system or a hierarchy problem that misleads the eye; **low** = a
   spacing-rhythm, alignment, or wording nit with no functional impact.
4. The **downstream ticket shape**: the target building `type` a confirmed high-severity finding
   resolves to (usually `feature`, sometimes `bug`), and exactly which fields that pipeline's own
   scope gate requires. Execute drafts it with `approved: false`.
5. The **grounding list**: every real surface, route, and component the review is expected to
   cite, taken from Explore, so Eval can resolve each finding's location on the live surface.
6. A task-specific **100-point Eval rubric** following [`../EVAL.md`](../EVAL.md). Weight the
   review's highest-risk qualities most heavily and mark these critical:
   - **findings verified** — every reported finding was independently reproduced on the
     re-rendered surface;
   - **no false positives** — anti-hallucination; any finding not observable on the surface is
     dropped, never shipped;
   - **evidence cited** — every finding resolves to the surface plus a specific element with a
     screenshot or accessibility-check proof;
   - **severity justified** — each severity matches the stated definitions;
   - **scope covered** — the declared surface, states, and viewports match the ticket's target;
   - a **valid drafted ticket** for any confirmed high-severity finding.
   Set a pass threshold from 80–100 (use 85 unless the task argues otherwise).

## Eval rubric

Author the concrete scorecard here, following the required table in [`../EVAL.md`](../EVAL.md):
weights are whole numbers totaling exactly 100, `passThreshold` is between 80 and 100, at least
one criterion is critical, and every criterion names evidence Eval can collect itself by
re-driving the surface. The `rubricReady`, `passThreshold`, and `rubricSha256` you return are
computed from this exact `## Eval rubric` section.

Hash the exact `## Eval rubric` section with SHA-256 and return `rubricReady`, `passThreshold`,
and `rubricSha256`. On a retry, keep the rubric byte-for-byte unchanged unless a human approved a
change. Return `rubricReady=true` and the `passThreshold` only when the scorecard totals 100 and
keeps every critical verification/evidence/severity/scope check.
