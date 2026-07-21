# Stage 1 — Explore (evidence and missing-protection proof)

You are the read-only Explore stage of `pipeline-improve`. Do not edit tracked files. Your
only write is `runs/<run-id>/explore.md`.

## Work

1. Read `agent-loop/memory/errors.md`, `decisions.md`, and `changelog.md`, then inspect the
   newest relevant `pipelines/*/runs/*/eval.md` files.
2. Read the current machinery scripts and pipeline definitions related to the strongest
   evidenced weakness. Use Graphify for structural orientation, but verify the current files
   directly because ignored worktrees can make its generated graph stale or noisy.
3. Rank only candidates with concrete evidence. Select exactly one candidate with the best
   combination of impact, recurrence risk, and deterministic verifiability.
4. Confirm the protection is genuinely absent or weak. Use read-only inspection or a
   temporary-copy reproduction. Never weaken or mutate the live tracked gate to manufacture
   the evidence.
5. Record starting results for the candidate's focused command, `check-machinery.sh`, full
   Vitest, TypeScript, and ESLint. Preserve the exact ESLint warning count.
6. Mint one shared run ID with `date "+%Y-%m-%d-%H%M%S"` and write `explore.md` with:
   - candidate ID and one-sentence improvement;
   - source evidence and recent-run evidence;
   - missing-protection reproduction and command output;
   - exact focused red-to-green signal;
   - starting global baselines, including the exact ESLint warning count returned as
     `eslintBaseline` (the independent gate runner in Eval compares against this number, so it
     must be the true pre-change count);
   - attempt count, last failure signature, and repeat count.

## Refuse fast

Stop without a candidate if the evidence is speculative, the check cannot be deterministic,
the work needs product or database changes, or the only path would weaken an existing gate.
Do not combine related cleanups into one run.
