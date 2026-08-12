// research — automated pipeline runtime (built-in Workflow, no external deps).
// Planning category: turn one question — about the world, a library/API, or this codebase — into a
// cited, fact-checked research report, looped explore → plan → execute → eval until the report
// scores at or above the locked threshold with no critical failures. Read-only on the product —
// the only writes are the report + sources under runs/<run-id>/. It answers the question; it does
// NOT propose a change or draft a build ticket (that is spec's job). maker (execute) != verifier
// (eval); eval on a different model. One runId is minted once and threaded through every stage
// (memory/errors.md).
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'research',
  description: 'Turn one question into a cited, fact-checked research report a human can trust and act on',
  phases: [{ title: 'Frame' }, { title: 'Research loop' }],
}

const P = 'agent-loop/pipelines/research'
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code). Pass
// `--provider=gpt` to route every stage to codex. READ=explore/plan, MAKE=execute, VERIFY=eval
// (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TICKET = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: research)'
const MAX = 3

// --- Delegation (see ../DELEGATION.md) -------------------------------------------------------
// Execute runs as a LEAD: split the question into independent sub-questions, hand each to a
// WORKER, desk-check what comes back, then SYNTHESIZE one report. Read-only, so unlike a writing
// team there are no file collisions to guard — sub-questions overlap harmlessly. The caps are the
// same, and for the same reason: over-spawning is how this pattern runs up a bill.
const MAX_WORKERS = 4
const MAX_REWORK = 1

const SPLIT = { type: 'object', required: ['questions'],
  properties: {
    questions: { type: 'array', items: { type: 'object', required: ['question', 'sources'],
      properties: { question: { type: 'string' }, sources: { type: 'string' } } } },
    reason: { type: 'string' },
  } }

const DESK = { type: 'object', required: ['accepted'],
  properties: {
    accepted: { type: 'boolean' },
    reason: { type: 'string' },
  } }

const FRAME = { type: 'object', required: ['accepted', 'runId'],
  properties: {
    accepted: { type: 'boolean' },
    runId: { type: 'string' },
    questionKind: { type: 'string' },   // world | library | codebase
    question: { type: 'string' },
    note: { type: 'string' },
  } }

const PLAN = { type: 'object', required: ['rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  } }

const VERDICT = { type: 'object',
  required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256',
    'sectionsComplete', 'sourcesResolve', 'claimsSupported', 'noUnsupportedClaims', 'questionAnswered',
    'uncertaintyStated'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    sectionsComplete: { type: 'boolean' },      // required section contract present
    sourcesResolve: { type: 'boolean' },        // every URL fetches and every cited file exists (anti-hallucination)
    claimsSupported: { type: 'boolean' },       // every material claim bound to a source that actually says it
    noUnsupportedClaims: { type: 'boolean' },   // nothing asserted as fact without a source that carries it
    questionAnswered: { type: 'boolean' },      // the report answers the asked question, not an easier neighbour
    uncertaintyStated: { type: 'boolean' },     // thin/conflicting/missing evidence disclosed, not smoothed over
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Frame')
const frame = await agent(
  `You are the EXPLORE stage of the research pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Apply the scope gate: accept only a genuine researchable question this pipeline can answer from
   sources. Classify it as world, library/API, or codebase. For a codebase question, use
   \`graphify query\` to orient and record the real files/symbols the answer must cite. Frame the
   sub-questions and the source types that would settle it. Return accepted, runId, the questionKind,
   and a one-line restatement of the question. If the request wants a scope not an answer (route to
   spec), is already buildable, is an owner-only judgment, or is many questions at once, set
   accepted=false and explain in note — do not invent an answer.`,
  { label: 'explore', schema: FRAME, ...TIER.read })

if (!frame.accepted) {
  log(`STOP: not a research task — ${frame.note || 'see explore notes'}. Routed elsewhere or returned.`)
  return { researched: false, note: frame.note }
}

const RUN = frame.runId
log(`run ${RUN} — framed. question kind: ${frame.questionKind || 'tbd'}`)

phase('Research loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Question: ${frame.question}. Question kind: ${frame.questionKind}.
     ${last ? `Previous attempt failed: ${last}. Adjust.` : ''}
     Decide the report's structure, the search strategy, and the source-quality bar for this
     question, then author the task-specific 100-point Eval rubric required by plan.md (claims
     supported by resolving sources, sources resolve, question answered, honest uncertainty, and no
     unsupported claims are critical). Hash the exact Eval-rubric section with SHA-256 and return
     rubricReady, passThreshold, and rubricSha256. On retries keep that section byte-for-byte
     unchanged unless a human approved a rubric change.`,
    { label: `plan#${i}`, phase: 'Research loop', schema: PLAN, ...TIER.read })

  if (!plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${plan.reason || 'see plan.md'}`)
    return { researched: false, invalidRubric: true, iterations: i, runId: RUN }
  }

  if (lockedRubricSha256 === null) {
    lockedRubricSha256 = plan.rubricSha256
    lockedPassThreshold = plan.passThreshold
  } else if (plan.rubricSha256 !== lockedRubricSha256 || plan.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval rubric or threshold changed after scoring began; human approval is required.')
    return { researched: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  // EXECUTE — the lead decides whether the question splits into independent sub-questions.
  const split = await agent(
    `You are the LEAD of the execute stage. Follow ${P}/execute.md and ../DELEGATION.md.
     Read \`${P}/runs/${RUN}/plan.md\` and split the question into INDEPENDENT sub-questions —
     independent means each can be researched without another's answer. Return at most
     ${MAX_WORKERS}, each with the source types that would settle it. Return ZERO OR ONE when the
     question is a single line of enquiry or each step depends on the last answer: the solo path is
     the default and is not a failure. Do not manufacture sub-questions to look thorough.`,
    { label: `split#${i}`, phase: 'Research loop', schema: SPLIT, ...TIER.read })

  // The cap is applied HERE, in code — whatever the lead proposed, at most MAX_WORKERS run.
  const questions = (split.questions || []).slice(0, MAX_WORKERS)
  if ((split.questions || []).length > MAX_WORKERS) {
    log(`lead proposed ${split.questions.length} sub-questions; capped to ${MAX_WORKERS}`)
  }

  let unanswered = []
  if (questions.length <= 1) {
    log(`iter ${i}: solo path — ${split.reason || 'one line of enquiry'}`)
    await agent(
      `You are the EXECUTE stage (MAKER, working solo). Follow ${P}/execute.md. Write only into
       \`${P}/runs/${RUN}/\`. Run the research with the deep-research skill and /investigate, then
       write the complete cited report (report.md) and its sources list (sources.md). Read every
       source before you cite it; bind every material claim to a source that actually says it; move
       anything the sources do not support into the Uncertainty section. Do NOT edit product source,
       schema, or the live orchestrator inbox. If the plan cannot answer the question without
       inventing sources, stop and report — don't manufacture evidence.`,
      { label: `execute#${i}`, phase: 'Research loop', ...TIER.make })
  } else {
    log(`iter ${i}: delegating ${questions.length} sub-question(s)`)
    const reviewed = await pipeline(
      questions,
      (item, _original, n) => agent(
        `You are a WORKER on the research team. Follow ${P}/execute.md. Research EXACTLY this one
         sub-question and nothing else: ${item.question} (likely sources: ${item.sources})
         Write your findings to \`${P}/runs/${RUN}/notes-${n + 1}.md\` — notes and sources only, not
         the report; the lead writes that. Read every source before you cite it and bind every claim
         to a source that actually says it. Do NOT edit product source, schema, or the live
         orchestrator inbox. Do NOT delegate any part of this to another agent — you are the one
         doing the work. If the sources do not answer it, say so; never manufacture evidence.`,
        { label: `worker#${i}.${n + 1}`, phase: 'Research loop', ...TIER.make }),

      async (_notes, item, n) => {
        // DESK CHECK — a different agent than the worker. Cheap early filter on fabricated or
        // unsupported sourcing, so Eval's adversarial fact-check starts from a cleaner draft.
        let note = ''
        for (let attempt = 0; attempt <= MAX_REWORK; attempt++) {
          const desk = await agent(
            `You are the LEAD desk-checking a worker's notes before they enter the report.
             Sub-question: ${item.question}
             Read \`${P}/runs/${RUN}/notes-${n + 1}.md\`. Accept only if every source resolves, each
             cited source actually supports the claim attached to it, and the notes answer the
             sub-question asked rather than an easier neighbour. Reject with a specific, actionable
             reason otherwise. You are reviewing, not researching — do not fill the gaps yourself.`,
            { label: `desk#${i}.${n + 1}${attempt ? `r${attempt}` : ''}`, phase: 'Research loop', schema: DESK, ...TIER.verify })
          if (desk.accepted) return { item, accepted: true }
          note = desk.reason || 'rejected without a reason'
          if (attempt === MAX_REWORK) break
          await agent(
            `You are the WORKER. Your notes were rejected at desk check: ${note}
             Fix exactly that for: ${item.question}. Re-read the sources, do not widen the
             sub-question, do not delegate, never manufacture evidence.`,
            { label: `rework#${i}.${n + 1}`, phase: 'Research loop', ...TIER.make })
        }
        return { item, accepted: false, reason: note }
      })

    unanswered = reviewed.filter(Boolean).filter((r) => !r.accepted)
    log(`iter ${i}: ${questions.length - unanswered.length}/${questions.length} sub-question(s) accepted at desk check`)

    // SYNTHESIS — a research team's product is one report, not a pile of notes. Unlike a build,
    // the workers' output is not the deliverable, so the lead assembles it.
    await agent(
      `You are the LEAD, synthesizing the team's accepted notes into the report. Follow
       ${P}/execute.md. Write only into \`${P}/runs/${RUN}/\`: the complete cited report (report.md)
       and its sources list (sources.md). Build it from \`notes-*.md\`, carrying each claim's source
       through — do not re-assert anything the notes do not carry.
       ${unanswered.length ? `These sub-questions did NOT pass desk check and must appear in the Uncertainty section as open, not smoothed over: ${unanswered.map((r) => r.item.question).join('; ')}.` : ''}
       Move anything the sources do not support into Uncertainty. Never manufacture evidence.`,
      { label: `synthesize#${i}`, phase: 'Research loop', ...TIER.make })
  }

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     ${unanswered.length ? `The lead reports ${unanswered.length} sub-question(s) NOT accepted at desk check: ${unanswered.map((r) => r.item.question).join('; ')}. A desk check is not your verdict — fact-check the whole report yourself, and treat any of these presented as settled rather than open as a critical failure.` : ''}
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Adversarially fact-check the report: fetch
     every source yourself (a dead or invented source is a critical failure), open each citation and
     confirm the source actually supports the claim it is attached to, sweep for any unsupported
     claim, confirm the report answers the asked question, and confirm uncertainty is stated rather
     than hidden. Apply the locked rubric at SHA-256 ${lockedRubricSha256} and threshold
     ${lockedPassThreshold}/100. Return score, passThreshold, criticalFailures, rubricValid,
     rubricSha256, and the section booleans.`,
    { label: `eval#${i}`, phase: 'Research loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · sources ${v.sourcesResolve ? 'resolve' : 'DEAD'} · claims ${v.claimsSupported ? 'supported' : 'UNSUPPORTED'} · answered ${v.questionAnswered ? 'yes' : 'NO'} · honest ${v.uncertaintyStated ? 'yes' : 'NO'}`)

  if (v.rubricSha256 !== lockedRubricSha256 || v.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval observed a changed rubric fingerprint or threshold; human approval is required.')
    return { researched: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  if (v.verdict === 'pass' && v.rubricValid && v.rubricSha256 === lockedRubricSha256 && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.sectionsComplete && v.sourcesResolve && v.claimsSupported && v.noUnsupportedClaims && v.questionAnswered && v.uncertaintyStated) {
    // Planning gate: a passing report is NOT a product change. The owner reads the answer and
    // decides what to do with it; any resulting change starts a separate spec or building ticket.
    log(`REPORT READY: read ${P}/runs/${RUN}/report.md and sources.md; the answer is grounded and fact-checked.`)
    return { researched: true, awaitingOwnerReview: true, iterations: i, questionKind: frame.questionKind, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'} · sources ${v.sourcesResolve ? 'resolve' : 'dead'} · claims ${v.claimsSupported ? 'supported' : 'unsupported'}`
}

log(`STOP: no passing report within ${MAX} iterations — handing back to a human.`)
return { researched: false, iterations: i, runId: RUN }
