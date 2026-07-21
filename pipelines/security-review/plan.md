# Stage 2 — Plan (read-only)

You are the Plan stage. Read `runs/<run-id>/explore.md`. Do not write the findings report itself
and do not edit source. Write `runs/<run-id>/plan.md`.

## Write the plan

1. The **review scope** for this change, bound to the ticket: the exact files and hunks the maker
   must review, taken from Explore's attack-surface map, and **which security rules apply to each**
   (authN/authZ + ownership, Zod input validation, error-message leakage, `NEXT_PUBLIC_`/secret
   exposure, rate limiting, full-DB-object props). State explicitly what is out of scope (files the
   change does not touch, pre-existing debt) so the review neither skips the change nor wanders
   outside it.
2. The **finding shape** every finding must follow: `severity · location (file:line) · cited
   vulnerable code · concrete exploit/impact · why it matters`. Findings cover security
   vulnerabilities against this repo's rules — this is not a correctness, architecture, or design
   review.
3. The **severity definitions** for this change, so severity is graded against a fixed bar and not
   the maker's emphasis. For example: **high** = an exploitable authz/IDOR/unvalidated-input/secret-
   exposure hole with a concrete attack path (a request an attacker can send to reach or mutate data
   they should not); **medium** = a real weakness with a narrow or partly guarded trigger, or a
   leak of low-sensitivity data; **low** = a defense-in-depth or hardening gap with no reachable
   exploit today.
4. The **downstream ticket shape**: the target building `type` a confirmed high-severity finding
   resolves to (usually `bug`, sometimes `feature` for a missing control such as rate limiting),
   and exactly which fields that pipeline's own scope gate requires. Execute drafts it with
   `approved: false`.
5. The **grounding list**: every real file/service/route/table the review is expected to cite, taken
   from Explore, so Eval can resolve each finding's location and trace its path.
6. A task-specific **100-point Eval rubric** following [`../EVAL.md`](../EVAL.md). Weight the
   review's highest-risk qualities most heavily and mark these critical:
   - **findings verified** — every reported vulnerability was independently traced or its cited code
     re-confirmed;
   - **no false positives** — anti-hallucination; any finding whose missing guard actually exists
     upstream, whose input is already validated, or whose value is not a secret is dropped, never
     shipped;
   - **evidence cited** — every finding resolves to a real `file:line` with quoted vulnerable code
     and a concrete exploit/impact;
   - **severity justified** — each severity matches the stated definitions (reachable exploit vs.
     hardening gap);
   - **scope covered** — the declared review scope and rule coverage match the target's actual diff;
   - a **valid drafted ticket** for any confirmed high-severity finding.
   Set a pass threshold from 80–100 (use 85 unless the task argues otherwise).

Hash the exact `## Eval rubric` section with SHA-256 and return `rubricReady`, `passThreshold`,
and `rubricSha256`. On a retry, keep the rubric byte-for-byte unchanged unless a human approved a
change. Return `rubricReady=true` and the `passThreshold` only when the scorecard totals 100 and
keeps every critical verification/evidence/severity/scope check.
