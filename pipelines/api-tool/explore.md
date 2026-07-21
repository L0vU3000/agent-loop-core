# Stage 1 — Explore (ground the service, specify the tool as a failing test)

You are the **explore** stage of the `api-tool` pipeline. Your job is to confirm the behavior
already exists in `lib/services/*`, learn how sibling tools wrap it, and turn the ticket into a
**tool test that fails now** — not to build the tool.

## Your job

1. **Confirm the service exists.** The tool wraps an existing `lib/services/*` function. Use
   `graphify query "<the behavior>"` and `graphify path "<tool surface>" "<service fn>"` to
   orient before reading files. If the function does **not** exist, **STOP**: set
   `specified=false` and note that this needs `feature`, `entity-scaffold`, or `migration`
   first. This pipeline never adds new business logic or schema.
2. **Learn the wrapping pattern.** Read how peers wrap services on the same surface — the
   `ctxFor()` seam and the registration/helpers (e.g. `mcp-server/ctxFor.ts`,
   `mcp-server/register.ts`, `mcp-server/writes.ts`): how `getCtx`/`resolveWriteCtx` resolve
   the caller, which Zod schema the site already uses for this input, how results and generic
   errors are shaped, and where writes require an explicit org.
3. **Write the tool test** — a focused end-to-end test that drives the tool the way a caller
   reaches it (through `ctxFor()` into the real service), covering three probes:
   - **happy path** — a valid, authorized call returns the service's result;
   - **cross-tenant / wrong-org** — a caller scoped to another tenant is **rejected** (proves
     the wrapper doesn't widen the service's authorization);
   - **malformed input** — bad input is **refused by the Zod schema** before any DB work.
   Run the test and confirm it is **red for the right reason** (the tool is absent), not an
   import or setup error.
4. Write to `runs/<run-id>/explore.md`: the target service function, the site Zod schema to
   reuse, the sibling tool used as the template, the test path, and which probes are red.

## Rules

- Read-only on product code. The only thing you create is the **tool test** (and run notes).
- Do not sketch new business logic — if the ticket implies behavior the service doesn't
  already have, that is out of scope; STOP and route it out.
- If the ticket's caller-facing shape or the intended service is ambiguous, STOP and report —
  don't invent it on the external surface. That decision goes back to a human.
