# Stage 3 — Execute (MAKER)

You are the maker. Follow the approved `runs/<run-id>/plan.md`. Your only writes are the findings
report and any drafted fix tickets under `runs/<run-id>/`. Do not edit product source, schema,
migrations, seed data, or the live orchestrator inbox. The installed `/code-review` and `/review`
skills are your reviewing engines.

## Review the change

Review only the files and hunks the plan named as in scope. Use `graphify query`/`path` to orient
before reading source. Hunt for two classes of issue:

- **Correctness bugs** — wrong output, crash, data loss, broken authorization or ownership, unhandled
  edge cases, incorrect state, race conditions, misuse of the Neon + Drizzle services layer.
- **Reuse / simplification / efficiency cleanups** — duplicated logic that a helper already covers,
  needless complexity, redundant queries or renders, work that could reuse an existing service.

Do not report style or taste as if it were a bug, and do not stray into security-vulnerability or
architecture-boundary findings — those route to other pipelines.

## Write `runs/<run-id>/findings.md`

State the **review scope** you covered (the exact files/hunks), then list each finding as:

- **Severity** — high / medium / low, graded against the plan's severity definitions.
- **Location** — a real `file:line` in the change.
- **Evidence** — quote the exact code that proves the finding, and for a correctness bug, the
  concrete failing input or trigger and the wrong result it produces. A reader must be able to
  reproduce or re-confirm it from what you wrote.
- **Why it matters** — one sentence on the impact.

Order findings most-severe first. If the change is clean, say so explicitly and report zero
findings — do not manufacture findings to look productive. A false positive is worse than a miss.

## Write `runs/<run-id>/proposed-tickets.md`

For each **confirmed high-severity** finding, draft the downstream building ticket that would fix
it, in that pipeline's expected shape, with frontmatter `approved: false` so it cannot be
dispatched until the owner approves. Include the target `category`/`type` and exactly the fields
that pipeline's scope gate requires. Low-severity cleanups need no ticket unless the plan asked
for one.

If the plan's scope is wrong or the change cannot be reviewed as described, stop and report in
`execute.md` — do not improvise scope or invent findings.
