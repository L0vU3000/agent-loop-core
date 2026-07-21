// spec — automated pipeline runtime (built-in Workflow, no external deps).
// Planning category: turn one unclear request into a precise, grounded, testable spec, looped
// explore → plan → execute → eval until the spec scores at or above the locked threshold with no
// critical failures. Read-only on the product — the only writes are the spec + a drafted
// `approved: false` ticket under runs/<run-id>/. maker (execute) != verifier (eval); eval on a
// different model. One runId is minted once and threaded through every stage (memory/errors.md).
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'spec',
  description: 'Turn a vague request into one bounded, grounded, testable specification a building pipeline can consume',
  phases: [{ title: 'Frame' }, { title: 'Draft loop' }],
}

const P = 'agent-loop/pipelines/spec'
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code). Pass
// `--provider=gpt` to route every stage to codex. READ=explore/plan, MAKE=execute, VERIFY=eval
// (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TICKET = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: spec)'
const MAX = 3

const FRAME = { type: 'object', required: ['accepted', 'runId'],
  properties: {
    accepted: { type: 'boolean' },
    runId: { type: 'string' },
    targetType: { type: 'string' },   // the building type this spec will resolve to
    intent: { type: 'string' },
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
    'sectionsComplete', 'referencesResolve', 'criteriaTestable', 'scopeBounded', 'notDuplicate',
    'openQuestionsListed', 'ticketDrafted'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    sectionsComplete: { type: 'boolean' },   // required section contract present
    referencesResolve: { type: 'boolean' },  // every file/table/route/service cited exists (anti-hallucination)
    criteriaTestable: { type: 'boolean' },   // every acceptance criterion is observable
    scopeBounded: { type: 'boolean' },        // one slice; in- and out-of-scope explicit
    notDuplicate: { type: 'boolean' },        // the proposed capability does not already exist
    openQuestionsListed: { type: 'boolean' }, // unmade decisions surfaced, not invented
    ticketDrafted: { type: 'boolean' },       // valid approved:false downstream ticket present
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Frame')
const frame = await agent(
  `You are the EXPLORE stage of the spec pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\` to orient before reading code. Apply the scope gate: accept only a
   genuine, unspecified building need that does NOT already exist in the product (grep services,
   actions, and derivations — a missing schema filename is not a missing feature). Gather the real
   codebase context the spec must cite. Return accepted, runId, the downstream building targetType,
   and a one-line intent. If the request is already buildable, a research question, an epic, an
   owner-only judgment, or already built, set accepted=false and explain in note — do not invent scope.`,
  { label: 'explore', schema: FRAME, ...TIER.read })

if (!frame.accepted) {
  log(`STOP: not a spec task — ${frame.note || 'see explore notes'}. Routed elsewhere or returned.`)
  return { specified: false, note: frame.note }
}

const RUN = frame.runId
log(`run ${RUN} — framed. downstream target: ${frame.targetType || 'tbd'}`)

phase('Draft loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Intent: ${frame.intent}. Downstream target: ${frame.targetType}.
     ${last ? `Previous attempt failed: ${last}. Adjust.` : ''}
     Decide the spec's structure and scope boundaries for this request, name the downstream
     building pipeline it resolves to, and author the task-specific 100-point Eval rubric required
     by plan.md (grounding, testable acceptance criteria, boundedness, no-duplicate, and honest
     open questions are critical). Hash the exact Eval-rubric section with SHA-256 and return
     rubricReady, passThreshold, and rubricSha256. On retries keep that section byte-for-byte
     unchanged unless a human approved a rubric change.`,
    { label: `plan#${i}`, phase: 'Draft loop', schema: PLAN, ...TIER.read })

  if (!plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${plan.reason || 'see plan.md'}`)
    return { specified: false, invalidRubric: true, iterations: i, runId: RUN }
  }

  if (lockedRubricSha256 === null) {
    lockedRubricSha256 = plan.rubricSha256
    lockedPassThreshold = plan.passThreshold
  } else if (plan.rubricSha256 !== lockedRubricSha256 || plan.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval rubric or threshold changed after scoring began; human approval is required.')
    return { specified: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\`. Write the complete spec (spec.md) and the drafted downstream ticket
     (proposed-ticket.md, with \`approved: false\`) exactly as the plan describes. Ground every
     reference in real code. Do NOT edit product source, schema, or the live orchestrator inbox.
     If the plan is wrong, stop and report — don't improvise scope.`,
    { label: `execute#${i}`, phase: 'Draft loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Independently resolve every reference the
     spec cites with \`graphify\` and file reads (an unresolved or invented reference is a critical
     failure), confirm each acceptance criterion is observable, confirm scope is bounded and the
     capability is not already built, and confirm the drafted approved:false ticket is valid. Apply
     the locked rubric at SHA-256 ${lockedRubricSha256} and threshold ${lockedPassThreshold}/100.
     Return score, passThreshold, criticalFailures, rubricValid, rubricSha256, and the section booleans.`,
    { label: `eval#${i}`, phase: 'Draft loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · grounded ${v.referencesResolve ? 'yes' : 'NO'} · testable ${v.criteriaTestable ? 'yes' : 'NO'} · bounded ${v.scopeBounded ? 'yes' : 'NO'} · new ${v.notDuplicate ? 'yes' : 'NO'}`)

  if (v.rubricSha256 !== lockedRubricSha256 || v.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval observed a changed rubric fingerprint or threshold; human approval is required.')
    return { specified: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  if (v.verdict === 'pass' && v.rubricValid && v.rubricSha256 === lockedRubricSha256 && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.sectionsComplete && v.referencesResolve && v.criteriaTestable && v.scopeBounded && v.notDuplicate && v.openQuestionsListed && v.ticketDrafted) {
    // Planning gate: a passing spec is NOT auto-dispatched. The owner approves the content, then
    // the drafted ticket is promoted from runs/ to the inbox with approved: true.
    log(`SPEC READY: review ${P}/runs/${RUN}/spec.md and proposed-ticket.md, then promote the ticket to the inbox to build it.`)
    return { specified: true, awaitingSpecApproval: true, iterations: i, targetType: frame.targetType, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'} · grounded ${v.referencesResolve ? 'yes' : 'no'} · testable ${v.criteriaTestable ? 'yes' : 'no'}`
}

log(`STOP: no passing spec within ${MAX} iterations — handing back to a human.`)
return { specified: false, iterations: i, runId: RUN }
