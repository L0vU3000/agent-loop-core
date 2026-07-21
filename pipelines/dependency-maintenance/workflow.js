// dependency-maintenance — built-in Workflow runtime.
// One shared run-id: Explore → approved Plan → one dependency batch → independent Eval.
// A passing batch is checkpointed locally. A failed Eval always returns to Plan.

export const meta = {
  name: 'dependency-maintenance',
  description: 'Reduce the npm outdated and audit backlog through approved, independently verified batches',
  phases: [{ title: 'Explore and plan' }, { title: 'Update and verify' }],
}

const P = 'agent-loop/pipelines/dependency-maintenance'
const RAW_ARGS = args || ''
const MAX_ATTEMPTS = 6
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
  const withinAgentCalls = agentCalls < MAX_AGENT_CALLS
  const declaredCeiling = Math.min(TOKEN_CEILING, budget.total || TOKEN_CEILING)
  const withinTokens = !budget.total || budget.spent() < declaredCeiling
  return withinAgentCalls && withinTokens
}

function recordAgentCall() {
  if (!budgetAvailable()) {
    throw new Error('dependency-maintenance stopped at its agent-call or token bound')
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

const EXPLORATION = {
  type: 'object',
  required: [
    'scope', 'runId', 'backlogStart', 'backlogCurrent', 'outdatedStart',
    'vulnerabilityStart', 'eligibleCount', 'attempts', 'lastFailure', 'repeatCount',
  ],
  properties: {
    scope: { enum: ['accept', 'refuse'] },
    runId: { type: 'string' },
    backlogStart: { type: 'number' },
    backlogCurrent: { type: 'number' },
    outdatedStart: { type: 'number' },
    vulnerabilityStart: { type: 'number' },
    eligibleCount: { type: 'number' },
    attempts: { type: 'number' },
    lastFailure: { type: 'string' },
    repeatCount: { type: 'number' },
    reason: { type: 'string' },
  },
}

const PLAN = {
  type: 'object',
  required: [
    'planReady', 'batchPlanned', 'allRemainingDeferred', 'batchDescription',
    'rubricReady', 'passThreshold', 'rubricSha256',
  ],
  properties: {
    planReady: { type: 'boolean' },
    batchPlanned: { type: 'boolean' },
    allRemainingDeferred: { type: 'boolean' },
    batchDescription: { type: 'string' },
    expectedBacklog: { type: 'number' },
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
    'rubricSha256', 'backlogPrevious', 'backlogCurrent', 'outdatedCurrent',
    'vulnerabilityCurrent', 'versionsLanded', 'unplannedDirectBumps', 'buildGreen',
    'suiteGreen', 'tscErrors', 'noNewEslintWarnings', 'noBehaviorChange',
    'allRemainingDeferred',
  ],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    backlogPrevious: { type: 'number' },
    backlogCurrent: { type: 'number' },
    outdatedCurrent: { type: 'number' },
    vulnerabilityCurrent: { type: 'number' },
    versionsLanded: { type: 'boolean' },
    unplannedDirectBumps: { type: 'number' },
    buildGreen: { type: 'boolean' },
    suiteGreen: { type: 'boolean' },
    tscErrors: { type: 'number' },
    noNewEslintWarnings: { type: 'boolean' },
    noBehaviorChange: { type: 'boolean' },
    allRemainingDeferred: { type: 'boolean' },
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
  log('STOP: pass a dependency-maintenance inbox ticket path, or --resume=<run-id>.')
  return { maintained: false, reason: 'missing ticket or run id' }
}

if (PLAN_APPROVED && !RESUME_RUN) {
  log('STOP: --approved-plan requires --resume=<run-id> from the matching Plan.')
  return { maintained: false, reason: 'approval has no prior run' }
}

log(`bounds: ${MAX_ATTEMPTS} attempts · ${MAX_AGENT_CALLS} agent calls · ${TOKEN_CEILING} declared tokens`)

phase('Explore and plan')
recordAgentCall()
const exploration = await agent(
  RESUME_RUN
    ? `You are the read-only EXPLORE checkpoint resuming dependency-maintenance run ${RESUME_RUN}.
       Follow ${P}/explore.md. Read the existing run notes and latest Eval. Return the stored scope,
       original JSON-derived counts, last independently accepted backlogCurrent, current eligible
       count, completed attempts, last failure, and repeat count. Use runId ${RESUME_RUN}; do not edit
       tracked files or mint a new run-id.`
    : `You are the read-only EXPLORE stage of dependency-maintenance. Follow ${P}/explore.md.
       Ticket: ${TICKET}. Mint one shared run-id with \`date "+%Y-%m-%d-%H%M%S"\`, create
       ${P}/runs/<run-id>, capture npm outdated/audit JSON plus repository baselines, classify each
       package, and write explore.md. Return scope, runId, backlogStart, backlogCurrent equal to the
       accepted start, outdatedStart, vulnerabilityStart, eligibleCount, attempts=0,
       lastFailure='', repeatCount=0, and reason. Refuse if the baseline cannot be reproduced.`,
  { label: 'explore', schema: EXPLORATION, ...TIER.read },
)

if (exploration.scope === 'refuse') {
  log(`STOP: scope refused — ${exploration.reason || 'see Explore notes'}`)
  return { maintained: false, refused: true, reason: exploration.reason, runId: exploration.runId }
}

if (exploration.attempts >= MAX_ATTEMPTS) {
  log(`STOP: run ${exploration.runId} reached its ${MAX_ATTEMPTS}-attempt bound.`)
  return { maintained: false, attempts: exploration.attempts, runId: exploration.runId }
}

const RUN = RESUME_RUN || exploration.runId

recordAgentCall()
const plan = await agent(
  PLAN_APPROVED
    ? `You are the PLAN approval checkpoint for dependency-maintenance run ${RUN}. Follow
       ${P}/plan.md. Read the existing plan.md without changing it. Return planReady=true only when
       it names one bounded eligible batch, exact targets and compatibility edits, restoration steps
       when the prior Eval failed, and a valid 100-point rubric. Return batchPlanned,
       allRemainingDeferred, batchDescription, expectedBacklog, rubricReady, passThreshold, and the
       SHA-256 fingerprint of the exact rubric section.`
    : `You are the read-only PLAN stage for dependency-maintenance run ${RUN}. Follow ${P}/plan.md.
       Read explore.md and the latest Eval. Write one bounded batch and its task-specific 100-point
       rubric to plan.md, hash the exact rubric section with SHA-256, and return planReady,
       batchPlanned, allRemainingDeferred, batchDescription, expectedBacklog, rubricReady,
       passThreshold, rubricSha256, and reason. Do not edit tracked files.`,
  { label: 'plan', phase: 'Explore and plan', schema: PLAN, ...TIER.read },
)

if (!plan.batchPlanned) {
  const reason = plan.allRemainingDeferred
    ? 'all remaining dependency entries need an owner decision'
    : plan.reason || 'no eligible dependency batch'
  log(`STOP: ${reason}. Human review closes or reroutes the work item.`)
  return { maintained: false, awaitingHumanReview: true, reason, runId: RUN }
}

if (!plan.planReady || !plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
  log(`STOP: Plan is incomplete — ${plan.reason || 'see run notes'}`)
  return { maintained: false, invalidPlan: true, reason: plan.reason, runId: RUN }
}

if (!PLAN_APPROVED) {
  log(`TRAINING STOP: review ${P}/runs/${RUN}/plan.md, then resume with --resume=${RUN} --approved-plan.`)
  return { maintained: false, awaitingPlanApproval: true, runId: RUN }
}

phase('Update and verify')
const attempt = exploration.attempts + 1

recordAgentCall()
await agent(
  `You are EXECUTE, the maker for dependency-maintenance run ${RUN}, attempt ${attempt}. Follow
   ${P}/execute.md and the approved plan. If a prior attempt failed, restore only that rejected
   attempt to the last accepted checkpoint first. Apply exactly this approved batch:
   ${plan.batchDescription}. Update package.json and package-lock.json through npm, apply only named
   compatibility edits, write execute.md, and do not commit or grade the work.`,
  { label: `execute#${attempt}`, phase: 'Update and verify', ...TIER.make },
)

recordAgentCall()
const verdict = await agent(
  `You are EVAL, a fresh read-only verifier for dependency-maintenance run ${RUN}, attempt
   ${attempt}. Follow ${P}/eval.md. Recompute the npm outdated and audit counts, inspect exact
   resolved versions and the complete diff, run build, Vitest, TypeScript, and ESLint, then write
   eval.md. Compare against the last accepted backlog ${exploration.backlogCurrent}. Apply the
   approved rubric at SHA-256 ${plan.rubricSha256} and threshold ${plan.passThreshold}/100. Return
   every structured field with cited evidence. Do not edit or suggest repairs.`,
  { label: `eval#${attempt}`, phase: 'Update and verify', schema: VERDICT, ...TIER.verify },
)

const batchPasses = verdict.verdict === 'pass'
  && verdict.rubricValid
  && verdict.rubricSha256 === plan.rubricSha256
  && verdict.passThreshold === plan.passThreshold
  && verdict.score >= plan.passThreshold
  && verdict.criticalFailures === 0
  && verdict.backlogPrevious === exploration.backlogCurrent
  && verdict.backlogCurrent < exploration.backlogCurrent
  && verdict.versionsLanded
  && verdict.unplannedDirectBumps === 0
  && verdict.buildGreen
  && verdict.suiteGreen
  && verdict.tscErrors === 0
  && verdict.noNewEslintWarnings
  && verdict.noBehaviorChange

log(`attempt ${attempt}: score ${verdict.score}/${verdict.passThreshold} · critical ${verdict.criticalFailures} · backlog ${verdict.backlogPrevious}→${verdict.backlogCurrent} · build ${verdict.buildGreen ? 'green' : 'RED'} · suite ${verdict.suiteGreen ? 'green' : 'RED'} · tsc ${verdict.tscErrors}`)

if (batchPasses) {
  recordAgentCall()
  const checkpoint = await agent(
    `You are the maker-side CHECKPOINT for dependency-maintenance run ${RUN}, attempt ${attempt}.
     Eval independently passed the approved batch. Confirm the tracked diff still matches the files
     Eval verified, then create one local worktree commit named
     "chore(deps): checkpoint approved dependency batch". Do not amend, push, merge, or edit files.
     Record the commit SHA in execute.md and return checkpointed and commitSha.`,
    { label: `checkpoint#${attempt}`, phase: 'Update and verify', schema: CHECKPOINT, ...TIER.make },
  )

  if (!checkpoint.checkpointed || !checkpoint.commitSha) {
    log(`STOP: verified batch could not be checkpointed — ${checkpoint.reason || 'see execute.md'}`)
    return { maintained: false, checkpointFailed: true, attempts: attempt, runId: RUN }
  }

  if (verdict.backlogCurrent === 0 || verdict.allRemainingDeferred) {
    log(`DONE: dependency backlog ${exploration.backlogStart}→${verdict.backlogCurrent}; remaining entries are zero or explicitly deferred.`)
    return {
      maintained: true,
      backlogStart: exploration.backlogStart,
      backlogCurrent: verdict.backlogCurrent,
      attempts: attempt,
      checkpoint: checkpoint.commitSha,
      runId: RUN,
    }
  }

  recordAgentCall()
  await agent(
    `You are PLAN after an accepted dependency batch for run ${RUN}. Follow ${P}/plan.md. The new
     independently accepted backlog is ${verdict.backlogCurrent}. Write the next bounded batch and a
     new task-specific rubric to plan.md. Do not edit tracked files. The next batch requires human
     approval before Execute.`,
    { label: `replan#${attempt}`, phase: 'Explore and plan', schema: PLAN, ...TIER.read },
  )

  log(`BATCH PASS: review the next Plan, then resume ${RUN} with --approved-plan.`)
  return { maintained: false, awaitingPlanApproval: true, attempts: attempt, runId: RUN }
}

const failure = `score ${verdict.score}/${plan.passThreshold}, critical failures ${verdict.criticalFailures}: ${verdict.reason || verdict.evidence || 'verification failed'}`
const repeatCount = failure === exploration.lastFailure ? exploration.repeatCount + 1 : 1

if (!budgetAvailable()) {
  log('STOP: Eval failed and this invocation reached its agent-call or token bound.')
  return { maintained: false, attempts: attempt, runId: RUN }
}

recordAgentCall()
await agent(
  `You are the failure-memory recorder for dependency-maintenance run ${RUN}, attempt ${attempt}.
   Append one factual Symptom / Cause / Fix / Prevention entry to agent-loop/memory/errors.md only
   when the failure exposes a reusable package or machinery landmine. Failure: ${failure}. Keep an
   unproven cause explicitly unknown and edit no other tracked file.`,
  { label: `memory#${attempt}`, phase: 'Update and verify', ...TIER.read },
)

recordAgentCall()
await agent(
  `You are PLAN after failed Eval for dependency-maintenance run ${RUN}, attempt ${attempt}. Follow
   ${P}/plan.md. Failure: ${failure}. Write a revised plan that first restores the rejected attempt
   to the last accepted checkpoint and then selects one bounded alternative. Record attempts=${attempt},
   lastFailure=${failure}, and repeatCount=${repeatCount}. Preserve the rejected batch's rubric in
   history; the new approved batch gets its own rubric before its first Eval. Do not edit tracked
   files.`,
  { label: `replan#${attempt}`, phase: 'Explore and plan', schema: PLAN, ...TIER.read },
)

if (repeatCount >= 2) {
  log(`STOP: no progress after the same verifier failure repeated twice — ${failure}`)
  return { maintained: false, noProgress: true, attempts: attempt, runId: RUN }
}

log(`EVAL FAIL: review the revised Plan, then resume ${RUN} with --approved-plan.`)
return { maintained: false, awaitingPlanApproval: true, attempts: attempt, runId: RUN }
