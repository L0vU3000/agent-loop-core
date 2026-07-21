// deploy — built-in Workflow runtime.
// One shared run-id: Explore → approved Plan → installed deploy capability → independent Eval.
// A production target requires a separate production approval. Eval failure returns to Plan.

export const meta = {
  name: 'deploy',
  description: 'Deploy one landed commit to one named environment after explicit approval',
  phases: [{ title: 'Explore and plan' }, { title: 'Deploy and verify' }],
}

const P = 'agent-loop/pipelines/deploy'
const RAW_ARGS = args || ''
const MAX_ATTEMPTS = 3
const MAX_AGENT_CALLS = 7
const TOKEN_CEILING = 40000

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
    throw new Error('deploy stopped at its agent-call or token bound')
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
const DEPLOY_APPROVED = hasFlag('--approve-deploy')
const PRODUCTION_APPROVED = hasFlag('--approve-production')

const EXPLORATION = {
  type: 'object',
  required: [
    'accepted', 'runId', 'deploymentIdentity', 'environment', 'production',
    'attempts', 'lastFailure', 'repeatCount',
  ],
  properties: {
    accepted: { type: 'boolean' },
    runId: { type: 'string' },
    deploymentIdentity: { type: 'string' },
    environment: { type: 'string' },
    production: { type: 'boolean' },
    attempts: { type: 'number' },
    lastFailure: { type: 'string' },
    repeatCount: { type: 'number' },
    reason: { type: 'string' },
  },
}

const PLAN = {
  type: 'object',
  required: [
    'planReady', 'rubricReady', 'passThreshold', 'rubricSha256', 'deploymentIdentity',
    'environment', 'production', 'actionSummary',
  ],
  properties: {
    planReady: { type: 'boolean' },
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    deploymentIdentity: { type: 'string' },
    environment: { type: 'string' },
    production: { type: 'boolean' },
    actionSummary: { type: 'string' },
    reason: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: [
    'verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256',
    'deploymentIdentity', 'revisionMatched', 'environmentMatched', 'providerComplete',
    'healthGreen', 'productionApproved', 'deployOnly',
  ],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    deploymentIdentity: { type: 'string' },
    revisionMatched: { type: 'boolean' },
    environmentMatched: { type: 'boolean' },
    providerComplete: { type: 'boolean' },
    healthGreen: { type: 'boolean' },
    productionApproved: { type: 'boolean' },
    deployOnly: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  },
}

if (!TICKET && !RESUME_RUN) {
  log('STOP: pass a deploy inbox ticket path, or --resume=<run-id>.')
  return { deployed: false, reason: 'missing ticket or run id' }
}

if ((PLAN_APPROVED || DEPLOY_APPROVED || PRODUCTION_APPROVED) && !RESUME_RUN) {
  log('STOP: approvals require --resume=<run-id> from the matching Plan.')
  return { deployed: false, reason: 'approval has no prior run' }
}

log(`bounds: ${MAX_ATTEMPTS} attempts · ${MAX_AGENT_CALLS} agent calls · ${TOKEN_CEILING} declared tokens`)

phase('Explore and plan')
recordAgentCall()
const exploration = await agent(
  RESUME_RUN
    ? `You are EXPLORE resuming deploy run ${RESUME_RUN}. Follow ${P}/explore.md. Read existing notes
       and latest Eval. Re-read landed commit, setup-deploy configuration, and provider state without
       changing them. Return the stored deploymentIdentity, environment, production classification,
       attempts, lastFailure, and repeatCount. Use runId ${RESUME_RUN}.`
    : `You are the read-only EXPLORE stage of deploy. Follow ${P}/explore.md. Ticket: ${TICKET}.
       Mint one shared run-id with \`date "+%Y-%m-%d-%H%M%S"\`, create ${P}/runs/<run-id>, confirm
       the exact commit is landed, read setup-deploy configuration, and gather read-only provider
       evidence. Write explore.md. Return accepted, runId, stable deploymentIdentity, environment,
       production, attempts=0, lastFailure='', repeatCount=0, and reason. Do not deploy or browse the
       live health target.`,
  { label: 'explore', schema: EXPLORATION, ...TIER.read },
)

if (!exploration.accepted) {
  log(`STOP: deploy scope refused — ${exploration.reason || 'see Explore notes'}`)
  return { deployed: false, refused: true, runId: exploration.runId, reason: exploration.reason }
}

if (exploration.attempts >= MAX_ATTEMPTS) {
  log(`STOP: run ${exploration.runId} reached its ${MAX_ATTEMPTS}-attempt bound.`)
  return { deployed: false, runId: exploration.runId, attempts: exploration.attempts }
}

const RUN = RESUME_RUN || exploration.runId

recordAgentCall()
const plan = await agent(
  PLAN_APPROVED
    ? `You are the PLAN approval checkpoint for deploy run ${RUN}. Follow ${P}/plan.md. Read the
       existing plan.md without changing it. Return its exact deploymentIdentity, environment,
       production classification, actionSummary, passThreshold, and rubricSha256. Mark readiness
       true only if it still matches current Explore evidence.`
    : `You are the read-only PLAN stage for deploy run ${RUN}. Follow ${P}/plan.md. Name the existing
       deployment capability, exact commit/environment/target, status and health evidence, stop
       conditions, and task-specific 100-point rubric. Hash the rubric section with SHA-256. Return
       planReady, rubricReady, passThreshold, rubricSha256, deploymentIdentity, environment,
       production, actionSummary, and reason. Do not change configuration or external state.`,
  { label: 'plan', phase: 'Explore and plan', schema: PLAN, ...TIER.read },
)

const planIsValid = plan.planReady
  && plan.rubricReady
  && Boolean(plan.rubricSha256)
  && plan.passThreshold >= 80
  && plan.passThreshold <= 100
  && plan.deploymentIdentity === exploration.deploymentIdentity
  && plan.environment === exploration.environment
  && plan.production === exploration.production

if (!planIsValid) {
  log(`STOP: Plan is incomplete or drifted — ${plan.reason || 'see run notes'}`)
  return { deployed: false, invalidPlan: true, runId: RUN, reason: plan.reason }
}

if (!PLAN_APPROVED || !DEPLOY_APPROVED) {
  log(`TRAINING STOP: review ${P}/runs/${RUN}/plan.md, then resume with --resume=${RUN} --approved-plan --approve-deploy${plan.production ? ' --approve-production' : ''}.`)
  return { deployed: false, awaitingDeployApproval: true, runId: RUN }
}

if (plan.production && !PRODUCTION_APPROVED) {
  log('STOP: the approved target is production and --approve-production is missing.')
  return { deployed: false, awaitingProductionApproval: true, runId: RUN }
}

phase('Deploy and verify')
const attempt = exploration.attempts + 1

recordAgentCall()
await agent(
  `You are EXECUTE, the maker for deploy run ${RUN}, attempt ${attempt}. Follow ${P}/execute.md.
   Approved identity: ${plan.deploymentIdentity}. Environment: ${plan.environment}. Action:
   ${plan.actionSummary}. Recheck the identity, then invoke only the configured land-and-deploy
   deploy/wait/one-pass verification capability. Observe an existing matching run instead of
   duplicating it. Write execute.md. Do not merge, roll back, publish, or grade.`,
  { label: `execute#${attempt}`, phase: 'Deploy and verify', ...TIER.make },
)

recordAgentCall()
const verdict = await agent(
  `You are EVAL, a fresh read-only verifier for deploy run ${RUN}, attempt ${attempt}. Follow
   ${P}/eval.md. Independently match the landed commit, provider record, environment, and configured
   current health evidence. Apply rubric SHA-256 ${plan.rubricSha256} at threshold
   ${plan.passThreshold}/100. Production approval supplied: ${PRODUCTION_APPROVED}. Return every
   structured field with evidence. Do not trigger, roll back, or suggest repairs.`,
  { label: `eval#${attempt}`, phase: 'Deploy and verify', schema: VERDICT, ...TIER.verify },
)

const deployPasses = verdict.verdict === 'pass'
  && verdict.rubricValid
  && verdict.rubricSha256 === plan.rubricSha256
  && verdict.passThreshold === plan.passThreshold
  && verdict.score >= plan.passThreshold
  && verdict.criticalFailures === 0
  && verdict.deploymentIdentity === plan.deploymentIdentity
  && verdict.revisionMatched
  && verdict.environmentMatched
  && verdict.providerComplete
  && verdict.healthGreen
  && (!plan.production || (PRODUCTION_APPROVED && verdict.productionApproved))
  && verdict.deployOnly

log(`attempt ${attempt}: score ${verdict.score}/${verdict.passThreshold} · critical ${verdict.criticalFailures} · revision ${verdict.revisionMatched ? 'matched' : 'MISMATCH'} · environment ${verdict.environmentMatched ? 'matched' : 'MISMATCH'} · provider ${verdict.providerComplete ? 'complete' : 'FAILED'} · health ${verdict.healthGreen ? 'green' : 'RED'}`)

if (deployPasses) {
  log(`DONE: deployment ${plan.deploymentIdentity} independently verified in ${plan.environment}.`)
  return {
    deployed: true,
    runId: RUN,
    attempts: attempt,
    deploymentIdentity: plan.deploymentIdentity,
    environment: plan.environment,
  }
}

const failure = `score ${verdict.score}/${plan.passThreshold}, critical failures ${verdict.criticalFailures}: ${verdict.reason || verdict.evidence || 'deployment verification failed'}`
const repeatCount = failure === exploration.lastFailure ? exploration.repeatCount + 1 : 1

recordAgentCall()
await agent(
  `You are the failure-memory recorder for deploy run ${RUN}, attempt ${attempt}. Append one factual
   Symptom / Cause / Fix / Prevention entry to agent-loop/memory/errors.md only if this failure
   exposes a reusable provider, health, or machinery landmine. Failure: ${failure}. Keep unknown
   causes explicit and edit no other tracked file.`,
  { label: `memory#${attempt}`, phase: 'Deploy and verify', ...TIER.read },
)

recordAgentCall()
await agent(
  `You are PLAN after failed Eval for deploy run ${RUN}, attempt ${attempt}. Follow ${P}/plan.md.
   Failure: ${failure}. Re-read provider state and distinguish delayed, failed, stale-health, and
   wrong-revision states before planning. Write a revised Plan, attempts=${attempt},
   lastFailure=${failure}, and repeatCount=${repeatCount}. Never duplicate an already-triggered
   deployment and never add a rollback without explicit approval. Preserve the locked rubric unless
   a human approves a change.`,
  { label: `replan#${attempt}`, phase: 'Explore and plan', schema: PLAN, ...TIER.read },
)

if (repeatCount >= 2) {
  log(`STOP: no progress after the same verifier failure repeated twice — ${failure}`)
  return { deployed: false, noProgress: true, attempts: attempt, runId: RUN }
}

log(`EVAL FAIL: review the revised Plan, then resume ${RUN} with fresh explicit approvals.`)
return { deployed: false, awaitingDeployApproval: true, attempts: attempt, runId: RUN }
