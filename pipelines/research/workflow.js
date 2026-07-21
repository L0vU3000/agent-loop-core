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

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\`. Run the research with the deep-research skill and /investigate, then
     write the complete cited report (report.md) and its sources list (sources.md). Read every
     source before you cite it; bind every material claim to a source that actually says it; move
     anything the sources do not support into the Uncertainty section. Do NOT edit product source,
     schema, or the live orchestrator inbox. If the plan cannot answer the question without
     inventing sources, stop and report — don't manufacture evidence.`,
    { label: `execute#${i}`, phase: 'Research loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
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
