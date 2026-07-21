---
name: research
category: planning
type: research
---

# Pipeline: research

> Turns one question — about the world, a library or API, or this codebase — into a cited,
> fact-checked research report. It answers the question; it does not propose a product change and
> it does not draft a build ticket. That is `spec`'s job.

## Goal

Take a question (an inbox item with `type: research`) and produce one research report: a direct
answer to the question, the material claims that support it, each claim backed by a citation that
actually says it, an explicit account of what remains uncertain, and a sources list. The
deliverable is `runs/<run-id>/report.md` plus a sources list — never a product change and never a
build ticket.

The report reads as an answer, not a plan. If the honest finding is that the question cannot be
answered from available sources, the report says so and shows what it searched.

## Scope gate

The ticket must carry a real question to research. Explore accepts only when the request is a
genuine question this pipeline can answer from sources. It refuses and routes elsewhere when the
request is:

- an unspecified building need that wants a scope, not an answer — route to `spec`;
- already precise enough to build — route straight to the matching building pipeline
  (`feature`, `bug-fix`, `entity`, `wiring`, `migration`, `api-tool`);
- a pure product or design judgment with no researchable content — the owner decides, not a pipeline;
- so broad it is many questions at once — return it asking the owner to name the one question to
  answer first.

A question about how this codebase already works is in scope: the report answers it from the real
files, and every file or symbol it cites must resolve.

## Exit condition

A run passes only when every check is true:

1. The report contains every required section: the question, a direct answer, the supporting
   claims, what is uncertain or unresolved, and the sources list.
2. Every material claim is backed by a citation that a reader can follow — a URL or a real
   repository file and path — and the cited source **actually supports the claim it is attached
   to**. A claim with no source, or with a source that does not say what the claim asserts, is a
   critical failure.
3. Every source resolves. Eval fetches each URL and reads each cited file itself; a dead link,
   an invented source, or a path that does not exist in the repository is a critical failure.
4. The question is actually answered. A report that circles the topic without answering the asked
   question fails, even if every sentence is individually sourced.
5. Uncertainty is stated, not hidden. Where the sources conflict, are thin, or do not settle the
   question, the report says so plainly rather than manufacturing false confidence.
6. No unsupported or invented claims. Anything the sources do not support is removed or moved into
   the uncertainty section, never asserted as fact.
7. The report is read-only on the product: it touches no source file, schema, migration, seed
   data, database row, or the live orchestrator inbox.

The score reaches the Plan threshold with zero critical failures. The owner then reads the report
and decides what to do with the answer.

## Verification technique

This pipeline uses **adversarial fact-checking of a document**, because its product is a research
report and the failure mode of research is not a broken test — it is a confident sentence that no
source supports. A verifier that only re-read the prose would inherit the maker's blind spots, so
this one works against the report rather than with it.

The verifier treats every material claim as guilty until a source proves it:

- **Claim-to-source binding** — for each claim, it opens the attached citation and confirms the
  source says what the claim asserts. A real link under a sentence the link does not support still
  fails; proximity is not evidence.
- **Sources resolve** — it fetches each URL and reads each cited repository file itself. A link
  that 404s, a source that was invented, or a file path that is not in the repo is a critical
  failure. It never trusts the maker's word that a source exists.
- **Question answered** — it re-reads the original question and confirms the report answers *that*
  question, not an easier neighbouring one.
- **Uncertainty honest** — it checks that thin, conflicting, or missing evidence is disclosed
  rather than smoothed over. A report that hides a gap is worse than one that names it.
- **No unsupported claims** — it sweeps for any assertion with no citation, or a citation that on
  inspection does not carry the claim, and treats a survivor as a critical failure.

The maker drafts the report; a different-model, read-only verifier adversarially checks it and
never rewrites it. The owner reads the answer and decides how to use it — the pipeline grades
whether the answer is grounded and honest, not whether the owner likes it.

Reference for the report's drafting shape: the installed `deep-research` skill (fan-out searches,
fetch sources, adversarially verify, synthesize a cited report) and `/investigate` are the
drafting engines the maker follows; this pipeline adds the scoring and maker≠verifier discipline
around them.

## Stages

`explore → plan → execute → eval`. Each stage runs in a fresh context. Execute is the maker;
Eval is a different-model, read-only verifier.

- **Explore:** classify the request against the scope gate, confirm it is a genuine researchable
  question and not a scope or build request, and frame what a complete answer needs — the
  sub-questions, the kinds of sources that would settle it, and (for a codebase question) the real
  files in play. Refuse fast on an out-of-scope request.
- **Plan:** decide the report's structure, the search strategy, and the source-quality bar for
  this question, then author the task-specific 100-point Eval rubric. Claims supported by
  resolving sources, sources that resolve, the question answered, honest uncertainty, and no
  unsupported claims are the critical criteria.
- **Execute (maker):** run the research with `deep-research` / `/investigate`, then write the
  complete cited report into `runs/<run-id>/report.md`. Do not edit product source, schema, or the
  live inbox.
- **Eval (verifier):** independently fact-check — fetch every source, bind every claim to a source
  that supports it, confirm the question is answered and uncertainty is honest — and score with
  cited evidence. On failure, return the scorecard to Plan.

## Guardrails

- **Read-only on the product.** This pipeline's only writes are the report and sources under
  `runs/<run-id>/`. It never edits source, schema, migrations, seed data, or the live orchestrator
  inbox, and needs no worktree or database branch. That makes it one of the safest pipelines; its
  risk is a confident but ungrounded answer, which the adversarial Eval and the human gate catch.
- **Human checkpoint.** The planning category's default gate applies: the owner reads the report
  and decides what to do with the answer. This pipeline never dispatches a building pipeline; if
  the answer implies a change, that starts a separate `spec` or building ticket the owner raises.
- **No invented sources or claims.** A report may not cite a source it did not read, attach a
  source to a claim the source does not support, or present a guess as a settled fact.
- **Bounds:** maximum 3 report attempts and a small agent-call cap per invocation; stop after the
  same verifier failure repeats twice.
- **Memory:** append failures and reusable lessons to `agent-loop/memory/errors.md`.

## Exit routing

A passing report is handed to the owner as an answer. The pipeline produces no downstream ticket.
If the owner decides the answer warrants a product change, they raise a `spec` or building ticket
separately — research informs that decision, it does not make it.

## Status and trigger

Authored, not yet proven — a planning pipeline alongside `spec`. Invoke `workflow.js` with a
`type: research` ticket path. Its proof waits for a real question whose answer can be checked
against resolving sources; it must not be exercised on a build request dressed up as a question.
