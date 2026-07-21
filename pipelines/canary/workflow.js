// canary — built-in Workflow runtime.
// One shared run-id: Explore → approved Plan → installed canary/rollback capability → independent Eval.
// Observation is read-only. Rollback requires a separate approval. Eval failure returns to Plan.

export const meta = {
  name: 'canary',
  description: 'Observe one deployment against approved health thresholds and escalate persistent failures',
  phases: [{ title: 'Explore and plan' }, { title: 'Observe or roll back' }],
}

const P = 'agent-loop/pipelines/canary'
const RAW_ARGS = args || ''
const MAX_ATTEMPTS = 3
const MAX_AGENT_CALLS = 7
const TOKEN_CEILING = 45000

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
    throw new Error('canary stopped at its agent-call or token bound')
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
const ROLLBACK_APPROVED = hasFlag('--approve-rollback')

const EXPLORATION = {
  type: 'object',
  required: [
    'accepted', 'runId', 'canaryIdentity', 'rollbackAvailable',
    'attempts', 'lastFailure', 'repeatCount',
  ],
  properties: {
    accepted: { type: 'boolean' },
    runId: { type: 'string' },
    canaryIdentity: { type: 'string' },
    rollbackAvailable: { type: 'boolean' },
    attempts: { type: 'number' },
    lastFailure: { type: 'string' },
    repeatCount: { type: 'number' },
    reason: { type: 'string' },
  },
}

const PLAN = {
  type: 'object',
  required: [
    'planReady', 'rubricReady', 'passThreshold', 'rubricSha256',
    'canaryIdentity', 'mode', 'actionSummary',
  ],
  properties: {
    planReady: { type: 'boolean' },
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    canaryIdentity: { type: 'string' },
    mode: { enum: ['observe', 'rollback'] },
    actionSummary: { type: 'string' },
    reason: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: [
    'verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256',
    'canaryIdentity', 'mode', 'signalCoverage', 'thresholdsFollowed', 'classification',
    'escalationRecorded', 'writeScopeValid', 'rollbackVerified',
  ],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    canaryIdentity: { type: 'string' },
    mode: { enum: ['observe', 'rollback'] },
    signalCoverage: { type: 'boolean' },
    thresholdsFollowed: { type: 'boolean' },
    classification: { enum: ['HEALTHY', 'DEGRADED', 'BROKEN'] },
    escalationRecorded: { type: 'boolean' },
    writeScopeValid: { type: 'boolean' },
    rollbackVerified: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  },
}

if (!TICKET && !RESUME_RUN) {
  log('STOP: pass a canary inbox ticket path, or --resume=<run-id>.')
  return { observed: false, reason: 'missing ticket or run id' }
}

if ((PLAN_APPROVED || ROLLBACK_APPROVED) && !RESUME_RUN) {
  log('STOP: approvals require --resume=<run-id> from the matching Plan.')
  return { observed: false, reason: 'approval has no prior run' }
}

log(`bounds: ${MAX_ATTEMPTS} attempts · ${MAX_AGENT_CALLS} agent calls · ${TOKEN_CEILING} declared tokens`)

phase('Explore and plan')
recordAgentCall()
const exploration = await agent(
  RESUME_RUN
    ? `You are EXPLORE resuming canary run ${RESUME_RUN}. Follow ${P}/explore.md. Read existing notes
       and latest Eval without browsing or changing the target. Reconfirm the deployment identity,
       observation contract, and named rollback availability from stored evidence. Return the stored
       canaryIdentity, rollbackAvailable, attempts, lastFailure, and repeatCount. Use runId
       ${RESUME_RUN}.`
    : `You are the read-only EXPLORE stage of canary. Follow ${P}/explore.md. Ticket: ${TICKET}.
       Mint one shared run-id with \`date "+%Y-%m-%d-%H%M%S"\`, create ${P}/runs/<run-id>, and write
       the deployment identity, approved duration/cadence/signals/baseline/thresholds, and named
       rollback availability to explore.md. Return accepted, runId, stable canaryIdentity,
       rollbackAvailable, attempts=0, lastFailure='', repeatCount=0, and reason. Do not browse the
       live target yet and never invent a baseline.`,
  { label: 'explore', schema: EXPLORATION, ...TIER.read },
)

if (!exploration.accepted) {
  log(`STOP: canary scope refused — ${exploration.reason || 'see Explore notes'}`)
  return { observed: false, refused: true, runId: exploration.runId, reason: exploration.reason }
}

if (exploration.attempts >= MAX_ATTEMPTS) {
  log(`STOP: run ${exploration.runId} reached its ${MAX_ATTEMPTS}-attempt bound.`)
  return { observed: false, runId: exploration.runId, attempts: exploration.attempts }
}

const RUN = RESUME_RUN || exploration.runId

recordAgentCall()
const plan = await agent(
  PLAN_APPROVED
    ? `You are the PLAN approval checkpoint for canary run ${RUN}. Follow ${P}/plan.md. Read the
       existing plan.md without changing it. Return its exact canaryIdentity, mode, actionSummary,
       passThreshold, and rubricSha256. Mark readiness true only if it still matches Explore.`
    : `You are the read-only PLAN stage for canary run ${RUN}. Follow ${P}/plan.md. Default to
       observe; select rollback only when persistent prior evidence and a named mechanism support it.
       Name the installed canary capability, exact observation contract, stop conditions, and
       task-specific 100-point rubric. Hash the rubric section with SHA-256. Return planReady,
       rubricReady, passThreshold, rubricSha256, canaryIdentity, mode, actionSummary, and reason.
       Do not browse or change external state.`,
  { label: 'plan', phase: 'Explore and plan', schema: PLAN, ...TIER.read },
)

const planIsValid = plan.planReady
  && plan.rubricReady
  && Boolean(plan.rubricSha256)
  && plan.passThreshold >= 80
  && plan.passThreshold <= 100
  && plan.canaryIdentity === exploration.canaryIdentity
  && (plan.mode === 'observe' || exploration.rollbackAvailable)

if (!planIsValid) {
  log(`STOP: Plan is incomplete or drifted — ${plan.reason || 'see run notes'}`)
  return { observed: false, invalidPlan: true, runId: RUN, reason: plan.reason }
}

if (!PLAN_APPROVED) {
  log(`TRAINING STOP: review ${P}/runs/${RUN}/plan.md, then resume with --resume=${RUN} --approved-plan${plan.mode === 'rollback' ? ' --approve-rollback' : ''}.`)
  return { observed: false, awaitingPlanApproval: true, runId: RUN, mode: plan.mode }
}

if (plan.mode === 'rollback' && !ROLLBACK_APPROVED) {
  log('STOP: Plan proposes rollback and --approve-rollback is missing.')
  return { observed: false, awaitingRollbackApproval: true, runId: RUN }
}

phase('Observe or roll back')
const attempt = exploration.attempts + 1

recordAgentCall()
await agent(
  `You are EXECUTE, the maker for canary run ${RUN}, attempt ${attempt}. Follow ${P}/execute.md.
   Mode: ${plan.mode}. Approved identity: ${plan.canaryIdentity}. Action: ${plan.actionSummary}.
   Invoke the installed canary capability exactly as planned. In rollback mode, require the explicit
   approval, invoke only the named land-and-deploy rollback path in an isolated worktree, then run the
   planned fresh canary check. Write execute.md and preserve evidence. Do not fix code, update the
   baseline, publish, or grade.`,
  { label: `execute#${attempt}`, phase: 'Observe or roll back', ...TIER.make },
)

recordAgentCall()
const verdict = await agent(
  `You are EVAL, a fresh read-only verifier for canary run ${RUN}, attempt ${attempt}. Follow
   ${P}/eval.md. Independently re-read every artifact and perform only the planned final read-only
   check. Apply rubric SHA-256 ${plan.rubricSha256} at threshold ${plan.passThreshold}/100. Mode:
   ${plan.mode}. Rollback approval supplied: ${ROLLBACK_APPROVED}. Return all structured fields with
   evidence. Do not edit, roll back, or suggest fixes.`,
  { label: `eval#${attempt}`, phase: 'Observe or roll back', schema: VERDICT, ...TIER.verify },
)

const honestClassification = verdict.classification === 'HEALTHY' || verdict.escalationRecorded
const rollbackGate = plan.mode === 'observe'
  ? !ROLLBACK_APPROVED && verdict.rollbackVerified === false
  : ROLLBACK_APPROVED && verdict.rollbackVerified

const canaryPasses = verdict.verdict === 'pass'
  && verdict.rubricValid
  && verdict.rubricSha256 === plan.rubricSha256
  && verdict.passThreshold === plan.passThreshold
  && verdict.score >= plan.passThreshold
  && verdict.criticalFailures === 0
  && verdict.canaryIdentity === plan.canaryIdentity
  && verdict.mode === plan.mode
  && verdict.signalCoverage
  && verdict.thresholdsFollowed
  && honestClassification
  && verdict.writeScopeValid
  && rollbackGate

log(`attempt ${attempt}: score ${verdict.score}/${verdict.passThreshold} · critical ${verdict.criticalFailures} · mode ${verdict.mode} · coverage ${verdict.signalCoverage ? 'complete' : 'INCOMPLETE'} · classification ${verdict.classification} · escalation ${verdict.escalationRecorded ? 'recorded' : 'none'}`)

if (canaryPasses) {
  const healthy = verdict.classification === 'HEALTHY'
  log(`${healthy ? 'DONE' : 'ESCALATED'}: canary ${plan.canaryIdentity} classified ${verdict.classification} with independently verified evidence.`)
  return {
    observed: true,
    healthy,
    classification: verdict.classification,
    escalated: !healthy,
    mode: plan.mode,
    runId: RUN,
    attempts: attempt,
  }
}

const failure = `score ${verdict.score}/${plan.passThreshold}, critical failures ${verdict.criticalFailures}: ${verdict.reason || verdict.evidence || 'canary verification failed'}`
const repeatCount = failure === exploration.lastFailure ? exploration.repeatCount + 1 : 1

recordAgentCall()
await agent(
  `You are the failure-memory recorder for canary run ${RUN}, attempt ${attempt}. Append one factual
   Symptom / Cause / Fix / Prevention entry to agent-loop/memory/errors.md only if this failure
   exposes a reusable monitoring, browser, rollback, or machinery landmine. Failure: ${failure}.
   Keep unknown causes explicit and edit no other tracked file.`,
  { label: `memory#${attempt}`, phase: 'Observe or roll back', ...TIER.read },
)

recordAgentCall()
await agent(
  `You are PLAN after failed Eval for canary run ${RUN}, attempt ${attempt}. Follow ${P}/plan.md.
   Failure: ${failure}. Write a revised Plan, attempts=${attempt}, lastFailure=${failure}, and
   repeatCount=${repeatCount}. Preserve the approved thresholds and rubric. Never turn an observation
   failure into rollback without a new explicit rollback approval. Do not change code or external
   state.`,
  { label: `replan#${attempt}`, phase: 'Explore and plan', schema: PLAN, ...TIER.read },
)

if (repeatCount >= 2) {
  log(`STOP: no progress after the same verifier failure repeated twice — ${failure}`)
  return { observed: false, noProgress: true, attempts: attempt, runId: RUN }
}

log(`EVAL FAIL: review the revised Plan, then resume ${RUN} with the required approval.`)
return { observed: false, awaitingPlanApproval: true, attempts: attempt, runId: RUN }
