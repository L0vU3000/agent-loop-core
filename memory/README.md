# Memory — the agent-loop's self-improvement substrate

> This folder is why the system can **optimize itself**. A loop that doesn't record what
> it did, what broke, and why we chose a design is doomed to repeat its mistakes. This is
> the same idea as a project knowledge vault, scoped to the agent-loop: *if a human wrote
> it or an agent should keep evolving it, it lives here.*

It mirrors the vault's own layout on purpose:

| File | Answers | Vault equivalent |
|---|---|---|
| [`changelog.md`](./changelog.md) | "What changed in the loop system, and when?" | `vault/changelog.md` |
| [`decisions.md`](./decisions.md) | "Why is the loop built this way?" | `vault/decisions/` |
| [`errors.md`](./errors.md) | "What broke, why, and how do we prevent it?" | `vault/error-log.md` |

## The rule that closes the loop

Every pipeline's **`eval` stage feeds this folder**:

- A pipeline **fails or does something dumb** → the lesson goes in [`errors.md`](./errors.md),
  and (if it's a recurring class of mistake) into the pipeline's own prompt or `CLAUDE.md`
  so the correction propagates to every future run. *(This is Boris Cherny's rule: teach the
  loop from its mistakes.)*
- We **change how a pipeline or the orchestrator works** → one line in [`changelog.md`](./changelog.md).
- We **make a load-bearing choice** (which engine, which check, autonomy level) →
  an entry in [`decisions.md`](./decisions.md).

## The meta-loop (the "always be optimizing" part)

The system is **never finished**. On a cadence, a review pass reads this folder and asks:
*what's the most common error? which stage is slowest? which pipeline has the weakest
verification?* — and proposes the next improvement. See
["This is an evolving system"](../agent-loop.md#this-is-an-evolving-system) in the hub doc.

Keep entries short and dated (`YYYY-MM-DD`). Newest first.

## Memory is not the curated vault

This directory is the compact, machine-facing evidence layer. Rich architectural reasoning,
research notes, recommendations, incidents, and open questions belong in
[`../vault/`](../vault/obsidian.md). A concise memory entry may link to a detailed vault note when
the lesson should influence `pipeline-improve`, but the vault does not replace these exact paths.

After the template is copied, project-curated context belongs under
[`../vault/project/`](../vault/project/README.md). Neither raw memory nor project vault content is
automatically reusable upstream; first distill the lesson into a neutral rule, test, or machinery
improvement.
