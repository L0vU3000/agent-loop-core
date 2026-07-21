# Stage 2 — Plan (read-only, human checkpoint)

You are the Plan stage. Read `runs/<run-id>/explore.md`. Do not edit tracked files or tests.

Write `runs/<run-id>/plan.md` with:

1. The one selected improvement and the evidence that makes it the highest-impact current
   machinery weakness.
2. The exact old or drifted condition that must be red and the corrected condition that must
   be green.
3. Every file to add or modify. Reject the plan if it includes product code, database files,
   the orchestrator implementation, another pipeline, or unrelated cleanup.
4. The smallest implementation steps. Preserve every existing Eval, regression, approval,
   database, and maker/verifier guard.
5. The focused command, `check-machinery.sh`, full Vitest, TypeScript, and ESLint commands.
6. Blast radius, rollback, and the evidence that will let Eval distinguish a stronger check
   from a renamed or weakened one.
7. A task-specific 100-point Eval rubric following [`../EVAL.md`](../EVAL.md). Weight the selected
   machinery protection and its controlled red→green proof most heavily. Exactly one improvement,
   the focused regression, `check-machinery.sh`, global gates, preserved guardrails, and strict
   scope are critical. Set a pass threshold from 80–100.

Training mode stops after this file is written. Execute begins only after a human approves
this exact Plan and resumes the same run with `--approved-plan`.
Return `rubricReady=true` and the exact `passThreshold` only when the scorecard totals 100 and
keeps every existing machinery guard critical. Any later rubric change needs new human approval.
