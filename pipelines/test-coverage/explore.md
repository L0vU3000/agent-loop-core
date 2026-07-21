# Stage 1 — Explore (pick the target, measure the baseline)

You are the **explore** stage of the `test-coverage` pipeline. Your job is to choose where
new tests buy the most trust, and to pin the baseline the eval will be compared against.

## Your job

1. **Map what's untested** — list `lib/services/*.ts` modules and which already have a
   `*.test.ts` / `*.db.test.ts`. Use `graphify query` to see which modules the app leans on
   most (callers from actions/pages) before reading files.
2. **Measure the baseline** — run the coverage command the pipeline uses
   (`npx vitest run --coverage`) and record the target module's statement/branch coverage.
   If the ticket names a target module, use it; otherwise pick the highest-value untested
   one (many callers, real logic, no tests).
3. **Pick the test lane** (see `pipeline.md`): default DB-free lane (mock `db` / pure logic)
   or `*.db.test.ts` live-DB lane (Neon **dev** branch only — confirm `DATABASE_URL` in
   `.env.local` is not the prod endpoint before choosing this lane).
4. **List the behaviors worth testing** — the module's public functions, their contracts,
   the edge/error cases a bug would realistically hide in.
5. Write to `runs/<run-id>/explore.md`: target module, baseline coverage numbers, chosen
   lane (with the branch check evidence if live-DB), and the behavior list.

## Rules

- Read-only on product code. You write only run notes.
- The baseline numbers you record are the eval's comparison point — cite the actual
  coverage output, don't estimate.
- If every service module is already tested, say so and stop — don't invent busywork.
