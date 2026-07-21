// release — built-in Workflow runtime.
// One shared run-id: Explore → approved coordination/finalization Plan → installed capabilities → Eval.
// Coordinate mode ends at a verified unsigned record. Finalize mode records an exact digest sign-off.

export const meta = {
  name: 'release',
  description: 'Coordinate notes, delivery evidence, and final owner sign-off for one release candidate',
  phases: [{ title: 'Explore and plan' }, { title: 'Coordinate and attest' }],
}

const P = 'agent-loop/pipelines/release'
const RAW_ARGS = args || ''
const MAX_ATTEMPTS = 3
const MAX_AGENT_CALLS = 8
const TOKEN_CEILING = 55000

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
    throw new Error('release stopped at its agent-call or token bound')
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
const RELEASE_APPROVED = hasFlag('--approve-release')
const FINAL_SIGNOFF = optionValue('--final-signoff=')

const EXPLORATION = {
  type: 'object',
  required: [
    'accepted', 'runId', 'releaseIdentity', 'recordReady', 'recordSha256',
    'attempts', 'lastFailure', 'repeatCount',
  ],
  properties: {
    accepted: { type: 'boolean' },
    runId: { type: 'string' },
    releaseIdentity: { type: 'string' },
    recordReady: { type: 'boolean' },
    recordSha256: { type: 'string' },
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
    'releaseIdentity', 'mode', 'actionSummary',
  ],
  properties: {
    planReady: { type: 'boolean' },
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    releaseIdentity: { type: 'string' },
    mode: { enum: ['coordinate', 'finalize'] },
    actionSummary: { type: 'string' },
    reason: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: [
    'verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256',
    'releaseIdentity', 'mode', 'notesVerified', 'deploymentVerified', 'canaryVerified',
    'recordSha256', 'ownerSignoffValid', 'noUnauthorizedPublication',
  ],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    releaseIdentity: { type: 'string' },
    mode: { enum: ['coordinate', 'finalize'] },
    notesVerified: { type: 'boolean' },
    deploymentVerified: { type: 'boolean' },
    canaryVerified: { type: 'boolean' },
    canaryRequired: { type: 'boolean' },
    recordSha256: { type: 'string' },
    ownerSignoffValid: { type: 'boolean' },
    noUnauthorizedPublication: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  },
}

if (!TICKET && !RESUME_RUN) {
  log('STOP: pass a release inbox ticket path, or --resume=<run-id>.')
  return { released: false, reason: 'missing ticket or run id' }
}

if ((PLAN_APPROVED || RELEASE_APPROVED || FINAL_SIGNOFF) && !RESUME_RUN) {
  log('STOP: approvals require --resume=<run-id> from the matching Plan or verified record.')
  return { released: false, reason: 'approval has no prior run' }
}

log(`bounds: ${MAX_ATTEMPTS} attempts · ${MAX_AGENT_CALLS} agent calls · ${TOKEN_CEILING} declared tokens`)

phase('Explore and plan')
recordAgentCall()
const exploration = await agent(
  RESUME_RUN
    ? `You are EXPLORE resuming release run ${RESUME_RUN}. Follow ${P}/explore.md. Read existing notes,
       release-record.md, and latest Eval. Re-read remote evidence without changing it. Return the
       stored releaseIdentity, whether a prior record is independently verified and ready, its exact
       SHA-256, attempts, lastFailure, and repeatCount. Use runId ${RESUME_RUN}.`
    : `You are the read-only EXPLORE stage of release. Follow ${P}/explore.md. Ticket: ${TICKET}.
       Mint one shared run-id with \`date "+%Y-%m-%d-%H%M%S"\`, create ${P}/runs/<run-id>, and map the
       release candidate, owner, verified notes, reviewed change, landing, deployment, and required
       canary evidence to their existing artifacts. Refuse and route any missing prerequisite.
       Write explore.md. Return accepted, runId, stable releaseIdentity, recordReady=false,
       recordSha256='', attempts=0, lastFailure='', repeatCount=0, and reason. Do not edit or perform
       delivery actions.`,
  { label: 'explore', schema: EXPLORATION, ...TIER.read },
)

if (!exploration.accepted) {
  log(`STOP: release scope refused — ${exploration.reason || 'see Explore notes'}`)
  return { released: false, refused: true, runId: exploration.runId, reason: exploration.reason }
}

if (exploration.attempts >= MAX_ATTEMPTS) {
  log(`STOP: run ${exploration.runId} reached its ${MAX_ATTEMPTS}-attempt bound.`)
  return { released: false, runId: exploration.runId, attempts: exploration.attempts }
}

const RUN = RESUME_RUN || exploration.runId

recordAgentCall()
const plan = await agent(
  PLAN_APPROVED
    ? `You are the PLAN approval checkpoint for release run ${RUN}. Follow ${P}/plan.md. Read the
       existing plan.md without changing it. Return its exact releaseIdentity, mode, actionSummary,
       passThreshold, and rubricSha256. Mark readiness true only if the Plan still matches Explore
       and, for finalize mode, the prior verified record and supplied sign-off digest.`
    : `You are the read-only PLAN stage for release run ${RUN}. Follow ${P}/plan.md. Select coordinate
       unless a prior independently verified record is ready and the named owner supplied its exact
       digest; then select finalize. Name the verified document-release, landing, deploy, and required
       canary artifacts. Stop and route any missing prerequisite instead of performing it. Write the
       release-record schema, stop conditions, and task-specific 100-point rubric, then hash it with
       SHA-256. Return planReady, rubricReady, passThreshold, rubricSha256, releaseIdentity, mode,
       actionSummary, and reason.`,
  { label: 'plan', phase: 'Explore and plan', schema: PLAN, ...TIER.read },
)

const modeMatchesState = plan.mode === 'coordinate'
  ? !FINAL_SIGNOFF
  : exploration.recordReady && Boolean(FINAL_SIGNOFF) && FINAL_SIGNOFF === exploration.recordSha256

const planIsValid = plan.planReady
  && plan.rubricReady
  && Boolean(plan.rubricSha256)
  && plan.passThreshold >= 80
  && plan.passThreshold <= 100
  && plan.releaseIdentity === exploration.releaseIdentity
  && modeMatchesState

if (!planIsValid) {
  log(`STOP: Plan is incomplete, drifted, or has an invalid final sign-off — ${plan.reason || 'see run notes'}`)
  return { released: false, invalidPlan: true, runId: RUN, reason: plan.reason }
}

if (!PLAN_APPROVED || !RELEASE_APPROVED) {
  const signoffPart = plan.mode === 'finalize' ? ` --final-signoff=${exploration.recordSha256}` : ''
  log(`TRAINING STOP: review ${P}/runs/${RUN}/plan.md, then resume with --resume=${RUN} --approved-plan --approve-release${signoffPart}.`)
  return { released: false, awaitingReleaseApproval: true, runId: RUN, mode: plan.mode }
}

phase('Coordinate and attest')
const attempt = exploration.attempts + 1

recordAgentCall()
await agent(
  `You are EXECUTE, the maker for release run ${RUN}, attempt ${attempt}. Follow ${P}/execute.md.
   Mode: ${plan.mode}. Approved identity: ${plan.releaseIdentity}. Action: ${plan.actionSummary}.
   In coordinate mode, read the independently verified document-release, landing, deploy, and
   required canary artifacts, confirm their identities agree, write release-record.md, and hash it.
   Stop and route a missing prerequisite; do not perform it. In finalize mode, verify final sign-off
   digest ${FINAL_SIGNOFF} against the prior verified record and record the named owner's sign-off
   without changing the record. Do not publish or announce.`,
  { label: `execute#${attempt}`, phase: 'Coordinate and attest', ...TIER.make },
)

recordAgentCall()
const verdict = await agent(
  `You are EVAL, a fresh read-only verifier for release run ${RUN}, attempt ${attempt}. Follow
   ${P}/eval.md. Independently cross-check notes, reviewed change, merge, deployment, health, canary,
   and the release-record digest. Apply rubric SHA-256 ${plan.rubricSha256} at threshold
   ${plan.passThreshold}/100. Mode: ${plan.mode}. Supplied final sign-off digest: ${FINAL_SIGNOFF || 'none'}.
   Return all structured fields with evidence. Do not edit or publish.`,
  { label: `eval#${attempt}`, phase: 'Coordinate and attest', schema: VERDICT, ...TIER.verify },
)

const canaryGate = !verdict.canaryRequired || verdict.canaryVerified
const signoffGate = plan.mode === 'coordinate'
  ? !verdict.ownerSignoffValid
  : verdict.ownerSignoffValid && verdict.recordSha256 === FINAL_SIGNOFF

const releasePasses = verdict.verdict === 'pass'
  && verdict.rubricValid
  && verdict.rubricSha256 === plan.rubricSha256
  && verdict.passThreshold === plan.passThreshold
  && verdict.score >= plan.passThreshold
  && verdict.criticalFailures === 0
  && verdict.releaseIdentity === plan.releaseIdentity
  && verdict.mode === plan.mode
  && verdict.notesVerified
  && verdict.deploymentVerified
  && canaryGate
  && Boolean(verdict.recordSha256)
  && signoffGate
  && verdict.noUnauthorizedPublication

log(`attempt ${attempt}: score ${verdict.score}/${verdict.passThreshold} · critical ${verdict.criticalFailures} · mode ${verdict.mode} · notes ${verdict.notesVerified ? 'verified' : 'FAILED'} · deploy ${verdict.deploymentVerified ? 'verified' : 'FAILED'} · record ${verdict.recordSha256 || 'missing'} · sign-off ${verdict.ownerSignoffValid ? 'valid' : 'pending'}`)

if (releasePasses && plan.mode === 'coordinate') {
  log(`RELEASE RECORD VERIFIED: owner must inspect ${P}/runs/${RUN}/release-record.md, then resume with --final-signoff=${verdict.recordSha256}.`)
  return {
    released: false,
    awaitingFinalSignoff: true,
    releaseRecordSha256: verdict.recordSha256,
    runId: RUN,
    attempts: attempt,
  }
}

if (releasePasses && plan.mode === 'finalize') {
  log(`DONE: release ${plan.releaseIdentity} has verified evidence and final owner sign-off. No external release was published.`)
  return {
    released: true,
    releaseIdentity: plan.releaseIdentity,
    releaseRecordSha256: verdict.recordSha256,
    runId: RUN,
    attempts: attempt,
  }
}

const failure = `score ${verdict.score}/${plan.passThreshold}, critical failures ${verdict.criticalFailures}: ${verdict.reason || verdict.evidence || 'release verification failed'}`
const repeatCount = failure === exploration.lastFailure ? exploration.repeatCount + 1 : 1

recordAgentCall()
await agent(
  `You are the failure-memory recorder for release run ${RUN}, attempt ${attempt}. Append one factual
   Symptom / Cause / Fix / Prevention entry to agent-loop/memory/errors.md only if this failure
   exposes a reusable notes, delivery-evidence, sign-off, or machinery landmine. Failure: ${failure}.
   Keep unknown causes explicit and edit no other tracked file.`,
  { label: `memory#${attempt}`, phase: 'Coordinate and attest', ...TIER.read },
)

recordAgentCall()
await agent(
  `You are PLAN after failed Eval for release run ${RUN}, attempt ${attempt}. Follow ${P}/plan.md.
   Failure: ${failure}. Write a revised Plan, attempts=${attempt}, lastFailure=${failure}, and
   repeatCount=${repeatCount}. Preserve the release identity, rubric, and evidence boundaries. Never
   invent notes, repeat completed delivery actions, or add publication. Do not change external state.`,
  { label: `replan#${attempt}`, phase: 'Explore and plan', schema: PLAN, ...TIER.read },
)

if (repeatCount >= 2) {
  log(`STOP: no progress after the same verifier failure repeated twice — ${failure}`)
  return { released: false, noProgress: true, attempts: attempt, runId: RUN }
}

log(`EVAL FAIL: review the revised Plan, then resume ${RUN} with the required approvals.`)
return { released: false, awaitingReleaseApproval: true, attempts: attempt, runId: RUN }
