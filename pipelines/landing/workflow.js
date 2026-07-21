// landing — built-in Workflow runtime.
// One shared run-id: Explore → approved Plan → installed landing capability → independent Eval.
// Training approval is always required. Eval failure always returns to Plan.

export const meta = {
  name: 'landing',
  description: 'Land one reviewed change after explicit approval and verify authoritative remote state',
  phases: [{ title: 'Explore and plan' }, { title: 'Land and verify' }],
}

const P = 'agent-loop/pipelines/landing'
const RAW_ARGS = args || ''
const MAX_ATTEMPTS = 3
const MAX_AGENT_CALLS = 7
const TOKEN_CEILING = 35000

let agentCalls = 0

function hasFlag(flag) {
  return RAW_ARGS.split(/\s+/).includes(flag)
}

function optionValue(prefix) {
  const option = RAW_ARGS.split(/\s+/).find((part) => part.startsWith(prefix))
  return option ? option.slice(prefix.length) : ''
}

function ticketPath() {
  return RAW_ARGS.split(/\s+/).find((part) => part.endsWith('.md')) || ''
}

function budgetAvailable() {
  const withinCalls = agentCalls < MAX_AGENT_CALLS
  const declaredCeiling = Math.min(TOKEN_CEILING, budget.total || TOKEN_CEILING)
  const withinTokens = !budget.total || budget.spent() < declaredCeiling
  return withinCalls && withinTokens
}

function recordAgentCall() {
  if (!budgetAvailable()) {
    throw new Error('landing stopped at its agent-call or token bound')
  }
  agentCalls += 1
}

const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(RAW_ARGS) ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? {
      read: { agentType: 'codex', effort: 'low' },
      make: { agentType: 'codex', effort: 'high' },
      verify: { agentType: 'codex', effort: 'medium' },
    }
  : {
      read: { model: 'sonnet' },
      make: { model: 'opus' },
      verify: { model: 'sonnet' },
    }

const TICKET = ticketPath()
const RESUME_RUN = optionValue('--resume=')
const PLAN_APPROVED = hasFlag('--approved-plan')
const MERGE_APPROVED = hasFlag('--approve-merge')

const EXPLORATION = {
  type: 'object',
  required: ['accepted', 'runId', 'landingIdentity', 'attempts', 'lastFailure', 'repeatCount'],
  properties: {
    accepted: { type: 'boolean' },
    runId: { type: 'string' },
    landingIdentity: { type: 'string' },
    attempts: { type: 'number' },
    lastFailure: { type: 'string' },
    repeatCount: { type: 'number' },
    reason: { type: 'string' },
  },
}

const PLAN = {
  type: 'object',
  required: ['planReady', 'rubricReady', 'passThreshold', 'rubricSha256', 'landingIdentity', 'actionSummary'],
  properties: {
    planReady: { type: 'boolean' },
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    landingIdentity: { type: 'string' },
    actionSummary: { type: 'string' },
    reason: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: [
    'verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256',
    'landingIdentity', 'revisionMatched', 'gatesCurrent', 'remoteMerged', 'landingOnly',
  ],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    landingIdentity: { type: 'string' },
    revisionMatched: { type: 'boolean' },
    gatesCurrent: { type: 'boolean' },
    remoteMerged: { type: 'boolean' },
    landingOnly: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  },
}

if (!TICKET && !RESUME_RUN) {
  log('STOP: pass a landing inbox ticket path, or --resume=<run-id>.')
  return { landed: false, reason: 'missing ticket or run id' }
}

if ((PLAN_APPROVED || MERGE_APPROVED) && !RESUME_RUN) {
  log('STOP: approvals require --resume=<run-id> from the matching Plan.')
  return { landed: false, reason: 'approval has no prior run' }
}

log(`bounds: ${MAX_ATTEMPTS} attempts · ${MAX_AGENT_CALLS} agent calls · ${TOKEN_CEILING} declared tokens`)

phase('Explore and plan')
recordAgentCall()
const exploration = await agent(
  RESUME_RUN
    ? `You are EXPLORE resuming landing run ${RESUME_RUN}. Follow ${P}/explore.md. Read existing
       run notes and the latest Eval. Re-read authoritative remote state without changing it. Return
       the stored landingIdentity, attempts, lastFailure, and repeatCount. Use runId ${RESUME_RUN};
       do not mint a new run-id.`
    : `You are the read-only EXPLORE stage of landing. Follow ${P}/explore.md. Ticket: ${TICKET}.
       Mint one shared run-id with \`date "+%Y-%m-%d-%H%M%S"\`, create ${P}/runs/<run-id>, gather
       review, CI, head/base, mergeability, and merge-method evidence through the installed delivery
       capabilities, and write explore.md. Return accepted, runId, a stable landingIdentity,
       attempts=0, lastFailure='', repeatCount=0, and reason. Do not change local or remote state.`,
  { label: 'explore', schema: EXPLORATION, ...TIER.read },
)

if (!exploration.accepted) {
  log(`STOP: landing scope refused — ${exploration.reason || 'see Explore notes'}`)
  return { landed: false, refused: true, runId: exploration.runId, reason: exploration.reason }
}

if (exploration.attempts >= MAX_ATTEMPTS) {
  log(`STOP: run ${exploration.runId} reached its ${MAX_ATTEMPTS}-attempt bound.`)
  return { landed: false, runId: exploration.runId, attempts: exploration.attempts }
}

const RUN = RESUME_RUN || exploration.runId

recordAgentCall()
const plan = await agent(
  PLAN_APPROVED
    ? `You are the PLAN approval checkpoint for landing run ${RUN}. Follow ${P}/plan.md. Read the
       existing plan.md without changing it. Return its exact landingIdentity, actionSummary,
       passThreshold, and rubricSha256. planReady and rubricReady are true only if the Plan still
       matches current Explore evidence and its rubric totals 100.`
    : `You are the read-only PLAN stage for landing run ${RUN}. Follow ${P}/plan.md. Write the exact
       approved head/base/merge action, stop conditions, and task-specific 100-point Eval rubric.
       Hash the exact rubric section with SHA-256. Return planReady, rubricReady, passThreshold,
       rubricSha256, landingIdentity, actionSummary, and reason. Do not edit tracked or remote state.`,
  { label: 'plan', phase: 'Explore and plan', schema: PLAN, ...TIER.read },
)

const planIsValid = plan.planReady
  && plan.rubricReady
  && Boolean(plan.rubricSha256)
  && plan.passThreshold >= 80
  && plan.passThreshold <= 100
  && plan.landingIdentity === exploration.landingIdentity

if (!planIsValid) {
  log(`STOP: Plan is incomplete or drifted — ${plan.reason || 'see run notes'}`)
  return { landed: false, invalidPlan: true, runId: RUN, reason: plan.reason }
}

if (!PLAN_APPROVED || !MERGE_APPROVED) {
  log(`TRAINING STOP: review ${P}/runs/${RUN}/plan.md, then resume with --resume=${RUN} --approved-plan --approve-merge.`)
  return { landed: false, awaitingMergeApproval: true, runId: RUN }
}

phase('Land and verify')
const attempt = exploration.attempts + 1

recordAgentCall()
await agent(
  `You are EXECUTE, the maker for landing run ${RUN}, attempt ${attempt}. Follow ${P}/execute.md.
   Approved identity: ${plan.landingIdentity}. Approved action: ${plan.actionSummary}. Recheck every
   readiness fact, then use the installed land-and-deploy landing portion only. Stop before deploy
   detection. Write execute.md. Do not grade, retry an ambiguous merge, deploy, or publish.`,
  { label: `execute#${attempt}`, phase: 'Land and verify', ...TIER.make },
)

recordAgentCall()
const verdict = await agent(
  `You are EVAL, a fresh read-only verifier for landing run ${RUN}, attempt ${attempt}. Follow
   ${P}/eval.md. Independently read authoritative remote state and the local diff. Apply rubric
   SHA-256 ${plan.rubricSha256} at threshold ${plan.passThreshold}/100. Return every structured field
   with cited evidence. Do not edit, merge, deploy, or suggest a retry.`,
  { label: `eval#${attempt}`, phase: 'Land and verify', schema: VERDICT, ...TIER.verify },
)

const landingPasses = verdict.verdict === 'pass'
  && verdict.rubricValid
  && verdict.rubricSha256 === plan.rubricSha256
  && verdict.passThreshold === plan.passThreshold
  && verdict.score >= plan.passThreshold
  && verdict.criticalFailures === 0
  && verdict.landingIdentity === plan.landingIdentity
  && verdict.revisionMatched
  && verdict.gatesCurrent
  && verdict.remoteMerged
  && verdict.landingOnly

log(`attempt ${attempt}: score ${verdict.score}/${verdict.passThreshold} · critical ${verdict.criticalFailures} · revision ${verdict.revisionMatched ? 'matched' : 'MISMATCH'} · merged ${verdict.remoteMerged ? 'yes' : 'NO'} · landing-only ${verdict.landingOnly ? 'yes' : 'NO'}`)

if (landingPasses) {
  log(`DONE: landing ${plan.landingIdentity} independently verified. Deployment remains separate.`)
  return { landed: true, runId: RUN, attempts: attempt, landingIdentity: plan.landingIdentity }
}

const failure = `score ${verdict.score}/${plan.passThreshold}, critical failures ${verdict.criticalFailures}: ${verdict.reason || verdict.evidence || 'landing verification failed'}`
const repeatCount = failure === exploration.lastFailure ? exploration.repeatCount + 1 : 1

recordAgentCall()
await agent(
  `You are the failure-memory recorder for landing run ${RUN}, attempt ${attempt}. Append one factual
   Symptom / Cause / Fix / Prevention entry to agent-loop/memory/errors.md only if this failure
   exposes a reusable delivery or machinery landmine. Failure: ${failure}. Keep unknown causes
   explicit and edit no other tracked file.`,
  { label: `memory#${attempt}`, phase: 'Land and verify', ...TIER.read },
)

recordAgentCall()
await agent(
  `You are PLAN after failed Eval for landing run ${RUN}, attempt ${attempt}. Follow ${P}/plan.md.
   Failure: ${failure}. Re-read authoritative remote state before planning. Write a revised Plan,
   attempts=${attempt}, lastFailure=${failure}, and repeatCount=${repeatCount}. Never plan a second
   merge command when remote state already reports merged. Preserve the locked rubric unless a human
   approves a change. Do not edit product or remote state.`,
  { label: `replan#${attempt}`, phase: 'Explore and plan', schema: PLAN, ...TIER.read },
)

if (repeatCount >= 2) {
  log(`STOP: no progress after the same verifier failure repeated twice — ${failure}`)
  return { landed: false, noProgress: true, attempts: attempt, runId: RUN }
}

log(`EVAL FAIL: review the revised Plan, then resume ${RUN} with fresh explicit approvals.`)
return { landed: false, awaitingMergeApproval: true, attempts: attempt, runId: RUN }
