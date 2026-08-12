# Stage 3 — Execute (MAKER)

You are the maker. Follow the approved `runs/<run-id>/plan.md`. Your only write is the report and
its sources under `runs/<run-id>/`. Do not edit product source, schema, migrations, seed data, or
the live orchestrator inbox. The installed `deep-research` skill and `/investigate` are your
drafting engines: fan out searches, fetch and read the sources, verify claims against them as you
go, then synthesize.

## Running as a team

This stage runs as a **team** when the work splits, and solo when it doesn't. The shared rules are
in [`../DELEGATION.md`](../DELEGATION.md).

**As the LEAD:** split into independent sub-questions — independent means neither needs the other's
output. **One, or none → solo path:** do the work yourself, per the rules below. That is the default
and it is not a failure. Otherwise delegate one sub-question per worker, **desk-check** each returned
piece before accepting it (does the evidence hold up? does it answer what was asked? is it inside
scope?), then synthesize the accepted `notes-*.md` into `report.md` + `sources.md`. Reject with a specific, actionable reason — you review, you don't redo the
work. A rejected sub-question gets **one** rework; still rejected, declare it openly in the report rather
than papering over it. This pipeline is read-only, so workers cannot collide — but the worker cap
and rework bound are still enforced by `workflow.js`, not by your judgment.

**As a worker (or solo):** stay inside your sub-question; another worker owns the rest. **Never delegate** —
there is no third level. Write into the one shared `runs/<run-id>/`; do not mint your own run-id.

## Write `runs/<run-id>/report.md`

Fill every section the plan named, and no more:

- **Question** — the asked question, restated so the answer is unambiguous.
- **Answer** — a direct answer to that question in a few sentences, no hedging filler.
- **Supporting claims** — the material claims that back the answer, each with an inline citation
  (a URL, or a real repository file and path) to the source that says it. One claim, one source
  that carries it — do not attach a source to a claim it does not support.
- **Uncertainty** — where the sources conflict, are thin, or do not settle the question, say so
  plainly. Move anything the sources do not support out of the answer and into here.
- **Sources** — every source you actually read, listed so a reader can follow each one. For a
  codebase question, cite the real file and path; confirm it exists before you cite it.

Read every source before you cite it. If you cannot find a source for a claim, do not assert the
claim — drop it or move it to Uncertainty. A confident sentence with no source is the exact failure
this pipeline exists to catch.

If the question cannot be answered from available sources, say so in the Answer and show under
Uncertainty what you searched — an honest "not answerable from these sources" is a valid report.

## Write `runs/<run-id>/sources.md`

List every source with enough detail to re-find and re-check it: for a URL, the link and what it
established; for a codebase question, the file path and the symbol or lines. Eval fetches and reads
each one, so a source you did not actually read must not appear here.

If the plan's strategy cannot answer the question without inventing sources or claims, stop and
report in `execute.md` — do not manufacture evidence.
