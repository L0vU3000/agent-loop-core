# Stage 2 — Plan (read-only)

You are the Plan stage. Read `runs/<run-id>/explore.md`. Do not write the report itself and do not
edit source. Write `runs/<run-id>/plan.md`.

## Write the plan

1. The **section outline** the report must fill, bound to this question: the question restated, a
   direct answer, the supporting claims, what is uncertain or unresolved, and the sources list.
2. The **search strategy** for this question — the sub-questions to fan out on, the source types
   that count as authoritative (primary docs over secondary commentary; the real repository for a
   codebase question), and how to handle version sensitivity or conflicting sources.
3. The **source-quality bar** — what makes a source good enough to carry a claim, and the rule
   that every material claim must be bound to a source that actually says it.
4. The **grounding list**: for a codebase question, every real file/symbol the answer is expected
   to cite, taken from Explore, so Eval can resolve each one.
5. A task-specific **100-point Eval rubric** following [`../EVAL.md`](../EVAL.md). Weight the
   report's highest-risk qualities most heavily and mark these critical:
   - **claims supported** — every material claim is bound to a source that actually supports it;
   - **sources resolve** — every URL fetches and every cited file exists (anti-hallucination);
   - **question answered** — the report answers the asked question, not an easier neighbour;
   - **honest uncertainty** — thin, conflicting, or missing evidence is disclosed, not smoothed over;
   - **no unsupported claims** — nothing is asserted as fact without a source that carries it;
   - **complete sections** — the required section contract is present and non-empty.
   Set a pass threshold from 80–100 (use 85 unless the question argues otherwise).

Hash the exact `## Eval rubric` section with SHA-256 and return `rubricReady`, `passThreshold`,
and `rubricSha256`. On a retry, keep the rubric byte-for-byte unchanged unless a human approved a
change. Return `rubricReady=true` and the `passThreshold` only when the scorecard totals 100 and
keeps every critical claim-support, source-resolution, question-answered, and honesty check.
