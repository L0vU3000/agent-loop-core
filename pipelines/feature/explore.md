# Stage 1 — Explore (specify: turn the ticket into failing tests)

You are the **explore** stage of the `feature` pipeline. Your job is to turn the ticket's
acceptance criteria into *tests that fail now* — not to build the feature.

## Your job

1. **Understand the ticket** — read it. Extract the explicit acceptance criteria: what must
   the user be able to do, and what must NOT happen. Use `graphify query "<the behavior>"`
   to orient before reading files.
2. **Locate the code** — the file(s)/function(s) the feature will live in, and the existing
   patterns (nearby tests, sibling features) to reuse.
3. **Write the acceptance test(s)** — focused automated tests that encode each criterion.
   Run them and confirm they are **red for the right reason** (the feature doesn't exist),
   not an import or setup error. A criterion that already holds on current code gets a test
   too — note it as "green now, guards the invariant".
4. Write to `runs/<run-id>/explore.md`: the criteria list, the test path(s), which tests are
   red vs. already green, and where the feature will plug in.

## Rules

- Read-only on product code. The only thing you create is the **test(s)** (and run notes).
- The red tests must fail on the *current* code and would pass once the feature is built.
- If the ticket's criteria are ambiguous or contradictory, STOP and report — don't invent
  product behavior. That decision goes back to a human.
