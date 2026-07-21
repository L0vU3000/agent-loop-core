// performance-burndown — built-in Workflow runtime.
// One shared run-id: locked median baseline → approved one-lever Plan → Execute → independent Eval.
// Accepted gains become local checkpoints. Every failed Eval returns to Plan.

export const meta = {
  name: 'performance-burndown',
  description: 'Move one measured performance metric toward an approved target without changing behavior',
  phases: [{ title: 'Measure and plan' }, { title: 'Change and verify' }],
}

const P = 'agent-loop/pipelines/performance-burndown'
const RAW_ARGS = args || ''
const MAX_ATTEMPTS = 6
const MAX_AGENT_CALLS = 7
const TOKEN_CEILING = 50000

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
  const withinAgentCalls = agentCalls < MAX_AGENT_CALLS
  const declaredCeiling = Math.min(TOKEN_CEILING, budget.total || TOKEN_CEILING)
  const withinTokens = !budget.total || budget.spent() < declaredCeiling
  return withinAgentCalls && withinTokens
}

function recordAgentCall() {
  if (!budgetAvailable()) {
    throw new Error('performance-burndown stopped at its agent-call or token bound')
  }

  agentCalls += 1
}

function measuredImprovement(previousValue, currentValue, direction, minimumImprovement) {
  const movement = direction === 'lower'
    ? previousValue - currentValue
    : currentValue - previousValue
  const changedInTargetDirection = movement > 0
  return changedInTargetDirection && movement >= minimumImprovement
}

function measuredTargetReached(currentValue, target, direction) {
  if (direction === 'lower') {
    return currentValue <= target
  }

  return currentValue >= target
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

const EXPLORATION = {
  type: 'object',
  required: [
    'scope', 'runId', 'alreadyMet', 'metric', 'direction', 'target', 'unit', 'surface',
    'baselineValue', 'bestValue', 'sampleCount', 'minimumImprovement', 'measurementRecipe',
    'behaviorCheck', 'attempts', 'consecutiveNoProgress', 'lastFailure', 'triedLevers',
  ],
  properties: {
    scope: { enum: ['accept', 'refuse'] },
    runId: { type: 'string' },
    alreadyMet: { type: 'boolean' },
    metric: { type: 'string' },
    direction: { enum: ['lower', 'higher'] },
    target: { type: 'number' },
    unit: { type: 'string' },
    surface: { type: 'string' },
    baselineValue: { type: 'number' },
    bestValue: { type: 'number' },
    sampleCount: { type: 'number' },
    minimumImprovement: { type: 'number' },
    measurementRecipe: { type: 'string' },
    behaviorCheck: { type: 'string' },
    attempts: { type: 'number' },
    consecutiveNoProgress: { type: 'number' },
    lastFailure: { type: 'string' },
    triedLevers: { type: 'string' },
    reason: { type: 'string' },
  },
}

const PLAN = {
  type: 'object',
  required: [
    'planReady', 'leverAvailable', 'changeDescription', 'rubricReady',
    'passThreshold', 'rubricSha256',
  ],
  properties: {
    planReady: { type: 'boolean' },
    leverAvailable: { type: 'boolean' },
    changeDescription: { type: 'string' },
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: [
    'verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid',
    'rubricSha256', 'metricPrevious', 'metricCurrent', 'metricImproved',
    'minimumImprovementMet', 'targetMet', 'measurementComparable', 'sampleCount',
    'behaviorUnchanged', 'suiteGreen', 'tscErrors', 'noNewEslintWarnings',
    'oneLeverDiff', 'developmentEndpointSafe',
  ],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    metricPrevious: { type: 'number' },
    metricCurrent: { type: 'number' },
    metricImproved: { type: 'boolean' },
    minimumImprovementMet: { type: 'boolean' },
    targetMet: { type: 'boolean' },
    measurementComparable: { type: 'boolean' },
    sampleCount: { type: 'number' },
    behaviorUnchanged: { type: 'boolean' },
    suiteGreen: { type: 'boolean' },
    tscErrors: { type: 'number' },
    noNewEslintWarnings: { type: 'boolean' },
    oneLeverDiff: { type: 'boolean' },
    developmentEndpointSafe: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  },
}

const CHECKPOINT = {
  type: 'object',
  required: ['checkpointed', 'commitSha'],
  properties: {
    checkpointed: { type: 'boolean' },
    commitSha: { type: 'string' },
    reason: { type: 'string' },
  },
}

if (!TICKET && !RESUME_RUN) {
  log('STOP: pass a performance-burndown inbox ticket path, or --resume=<run-id>.')
  return { optimized: false, reason: 'missing ticket or run id' }
}

if (PLAN_APPROVED && !RESUME_RUN) {
  log('STOP: --approved-plan requires --resume=<run-id> from the matching Plan.')
  return { optimized: false, reason: 'approval has no prior run' }
}

log(`bounds: ${MAX_ATTEMPTS} attempts · ${MAX_AGENT_CALLS} agent calls · ${TOKEN_CEILING} declared tokens`)

phase('Measure and plan')
recordAgentCall()
const exploration = await agent(
  RESUME_RUN
    ? `You are the read-only EXPLORE checkpoint resuming performance-burndown run ${RESUME_RUN}.
       Follow ${P}/explore.md. Read existing run notes and latest Eval. Return the locked metric
       contract, original median baseline, last independently accepted bestValue, sample count,
       minimum improvement, exact measurement recipe and behavior check, completed attempts,
       consecutive no-progress count, last failure, and tried levers. Use runId ${RESUME_RUN}; do
       not edit tracked files or mint a new run-id.`
    : `You are the read-only EXPLORE stage of performance-burndown. Follow ${P}/explore.md.
       Ticket: ${TICKET}. Mint one shared run-id with \`date "+%Y-%m-%d-%H%M%S"\`, create
       ${P}/runs/<run-id>, validate the quantitative scope, lock one comparable measurement recipe,
       collect at least three raw baseline samples and their median, record the behavior and
       repository baselines, and write explore.md. Return every structured contract field with
       attempts=0, consecutiveNoProgress=0, lastFailure='', and triedLevers=''.`,
  { label: 'explore', schema: EXPLORATION, ...TIER.read },
)

if (exploration.scope === 'refuse') {
  log(`STOP: scope refused — ${exploration.reason || 'see Explore notes'}`)
  return { optimized: false, refused: true, reason: exploration.reason, runId: exploration.runId }
}

if (exploration.sampleCount < 3) {
  log('STOP: Explore did not lock the required median-of-at-least-three recipe.')
  return { optimized: false, invalidMeasurement: true, runId: exploration.runId }
}

if (exploration.alreadyMet) {
  log(`NO CHANGE: baseline ${exploration.metric} already meets the approved target.`)
  return {
    optimized: false,
    alreadyMet: true,
    baselineValue: exploration.baselineValue,
    target: exploration.target,
    runId: exploration.runId,
  }
}

if (exploration.attempts >= MAX_ATTEMPTS) {
  log(`STOP: run ${exploration.runId} reached its ${MAX_ATTEMPTS}-attempt bound.`)
  return { optimized: false, attempts: exploration.attempts, runId: exploration.runId }
}

const RUN = RESUME_RUN || exploration.runId

recordAgentCall()
const plan = await agent(
  PLAN_APPROVED
    ? `You are the PLAN approval checkpoint for performance-burndown run ${RUN}. Follow
       ${P}/plan.md. Read the existing plan.md without changing it. Return planReady=true only when
       it preserves the locked metric contract, names one grounded untried lever, includes exact
       restoration steps after a rejected attempt, and contains a valid 100-point rubric. Return
       leverAvailable, changeDescription, rubricReady, passThreshold, and the SHA-256 fingerprint of
       the exact rubric section.`
    : `You are the read-only PLAN stage for performance-burndown run ${RUN}. Follow ${P}/plan.md.
       Read explore.md and the latest Eval. Choose one grounded untried lever, preserve the locked
       measurement and behavior contracts exactly, write the Plan and task-specific 100-point rubric,
       hash the exact rubric section with SHA-256, and return planReady, leverAvailable,
       changeDescription, rubricReady, passThreshold, rubricSha256, and reason.`,
  { label: 'plan', phase: 'Measure and plan', schema: PLAN, ...TIER.read },
)

if (!plan.leverAvailable) {
  log(`STOP: no grounded untried performance lever remains — ${plan.reason || 'see Plan notes'}`)
  return { optimized: false, noLever: true, reason: plan.reason, runId: RUN }
}

if (!plan.planReady || !plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
  log(`STOP: Plan is incomplete — ${plan.reason || 'see run notes'}`)
  return { optimized: false, invalidPlan: true, reason: plan.reason, runId: RUN }
}

if (!PLAN_APPROVED) {
  log(`TRAINING STOP: review ${P}/runs/${RUN}/plan.md, then resume with --resume=${RUN} --approved-plan.`)
  return { optimized: false, awaitingPlanApproval: true, runId: RUN }
}

phase('Change and verify')
const attempt = exploration.attempts + 1

recordAgentCall()
await agent(
  `You are EXECUTE, the maker for performance-burndown run ${RUN}, attempt ${attempt}. Follow
   ${P}/execute.md and the approved plan. If a prior attempt failed, restore only that rejected
   attempt to the last accepted checkpoint first. Apply exactly this one approved lever:
   ${plan.changeDescription}. Do not edit the locked measurement recipe, behavior check, tests, or
   unrelated files. Write execute.md and do not measure the final result, commit, or grade the work.`,
  { label: `execute#${attempt}`, phase: 'Change and verify', ...TIER.make },
)

recordAgentCall()
const verdict = await agent(
  `You are EVAL, a fresh read-only verifier for performance-burndown run ${RUN}, attempt
   ${attempt}. Follow ${P}/eval.md. Use this locked recipe exactly: ${exploration.measurementRecipe}.
   Take exactly ${exploration.sampleCount} samples, compute their median, and compare it with the last
   accepted best ${exploration.bestValue} ${exploration.unit}. The approved target is
   ${exploration.direction} than or equal to ${exploration.target} ${exploration.unit}; the predefined
   minimum improvement is ${exploration.minimumImprovement} ${exploration.unit}. Run this locked
   behavior check: ${exploration.behaviorCheck}. Run Vitest, TypeScript, and ESLint, inspect the full
   diff, and confirm any query work uses an approved read-only development endpoint. Write eval.md.
   Apply the approved rubric at SHA-256 ${plan.rubricSha256} and threshold
   ${plan.passThreshold}/100. Return every structured field with cited evidence. Do not edit or
   suggest repairs.`,
  { label: `eval#${attempt}`, phase: 'Change and verify', schema: VERDICT, ...TIER.verify },
)

const numericImprovement = measuredImprovement(
  verdict.metricPrevious,
  verdict.metricCurrent,
  exploration.direction,
  exploration.minimumImprovement,
)
const numericTargetReached = measuredTargetReached(
  verdict.metricCurrent,
  exploration.target,
  exploration.direction,
)

const attemptPasses = verdict.verdict === 'pass'
  && verdict.rubricValid
  && verdict.rubricSha256 === plan.rubricSha256
  && verdict.passThreshold === plan.passThreshold
  && verdict.score >= plan.passThreshold
  && verdict.criticalFailures === 0
  && verdict.metricPrevious === exploration.bestValue
  && verdict.metricImproved
  && verdict.minimumImprovementMet
  && numericImprovement
  && verdict.targetMet === numericTargetReached
  && verdict.measurementComparable
  && verdict.sampleCount === exploration.sampleCount
  && verdict.behaviorUnchanged
  && verdict.suiteGreen
  && verdict.tscErrors === 0
  && verdict.noNewEslintWarnings
  && verdict.oneLeverDiff
  && verdict.developmentEndpointSafe

log(`attempt ${attempt}: score ${verdict.score}/${verdict.passThreshold} · critical ${verdict.criticalFailures} · ${exploration.metric} ${verdict.metricPrevious}→${verdict.metricCurrent} ${exploration.unit} · target ${numericTargetReached ? 'met' : 'not-met'} · behavior ${verdict.behaviorUnchanged ? 'unchanged' : 'CHANGED'}`)

if (attemptPasses) {
  recordAgentCall()
  const checkpoint = await agent(
    `You are the maker-side CHECKPOINT for performance-burndown run ${RUN}, attempt ${attempt}.
     Eval independently accepted this one-lever gain. Confirm the tracked diff still matches the
     files Eval verified, then create one local worktree commit named
     "perf: checkpoint independently verified metric gain". Do not amend, push, merge, deploy, or
     edit files. Record the commit SHA in execute.md and return checkpointed and commitSha.`,
    { label: `checkpoint#${attempt}`, phase: 'Change and verify', schema: CHECKPOINT, ...TIER.make },
  )

  if (!checkpoint.checkpointed || !checkpoint.commitSha) {
    log(`STOP: verified gain could not be checkpointed — ${checkpoint.reason || 'see execute.md'}`)
    return { optimized: false, checkpointFailed: true, attempts: attempt, runId: RUN }
  }

  if (numericTargetReached) {
    log(`DONE: ${exploration.metric} ${exploration.baselineValue}→${verdict.metricCurrent} ${exploration.unit}; target ${exploration.target} met.`)
    return {
      optimized: true,
      metric: exploration.metric,
      baselineValue: exploration.baselineValue,
      finalValue: verdict.metricCurrent,
      target: exploration.target,
      attempts: attempt,
      checkpoint: checkpoint.commitSha,
      runId: RUN,
    }
  }

  recordAgentCall()
  await agent(
    `You are PLAN after an accepted performance gain for run ${RUN}. Follow ${P}/plan.md. The new
     independently accepted best is ${verdict.metricCurrent} ${exploration.unit}; the target remains
     ${exploration.target} ${exploration.unit}. Preserve the locked measurement contract, choose one
     grounded untried lever, and write the next Plan and rubric. Do not edit tracked files. The next
     lever requires human approval before Execute.`,
    { label: `replan#${attempt}`, phase: 'Measure and plan', schema: PLAN, ...TIER.read },
  )

  log(`GAIN ACCEPTED: review the next Plan, then resume ${RUN} with --approved-plan.`)
  return { optimized: false, awaitingPlanApproval: true, attempts: attempt, runId: RUN }
}

const failure = `score ${verdict.score}/${plan.passThreshold}, critical failures ${verdict.criticalFailures}: ${verdict.reason || verdict.evidence || 'verification failed'}`
const consecutiveNoProgress = numericImprovement && verdict.measurementComparable
  ? 0
  : exploration.consecutiveNoProgress + 1

if (!budgetAvailable()) {
  log('STOP: Eval failed and this invocation reached its agent-call or token bound.')
  return { optimized: false, attempts: attempt, runId: RUN }
}

recordAgentCall()
await agent(
  `You are the failure-memory recorder for performance-burndown run ${RUN}, attempt ${attempt}.
   Append one factual Symptom / Cause / Fix / Prevention entry to agent-loop/memory/errors.md only
   when this failure exposes a reusable measurement landmine or rejected lever. Failure: ${failure}.
   Keep an unproven cause explicitly unknown and edit no other tracked file.`,
  { label: `memory#${attempt}`, phase: 'Change and verify', ...TIER.read },
)

recordAgentCall()
await agent(
  `You are PLAN after failed Eval for performance-burndown run ${RUN}, attempt ${attempt}. Follow
   ${P}/plan.md. Failure: ${failure}. Preserve the locked measurement contract. Write a revised Plan
   that first restores the rejected attempt to the last accepted checkpoint, records the rejected
   lever, and selects one grounded alternative. Record attempts=${attempt},
   consecutiveNoProgress=${consecutiveNoProgress}, and lastFailure=${failure}. Do not edit tracked
   files.`,
  { label: `replan#${attempt}`, phase: 'Measure and plan', schema: PLAN, ...TIER.read },
)

if (consecutiveNoProgress >= 2) {
  log(`STOP: two consecutive attempts failed to produce a comparable improvement — ${failure}`)
  return { optimized: false, noProgress: true, attempts: attempt, runId: RUN }
}

log(`EVAL FAIL: review the revised Plan, then resume ${RUN} with --approved-plan.`)
return { optimized: false, awaitingPlanApproval: true, attempts: attempt, runId: RUN }
