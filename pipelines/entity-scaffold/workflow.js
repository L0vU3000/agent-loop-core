// entity-scaffold — built-in Workflow runtime.
// One approved property-child entity: scope → plan approval → migration preparation →
// migration approval → apply → independent eval. Eval failure returns to Plan.
// A single shared run-id is threaded through every invocation and stage.

export const meta = {
  name: 'entity-scaffold',
  description: 'Build one approved org-scoped property-child entity through every backend layer',
  phases: [{ title: 'Scope and plan' }, { title: 'Prepare migration' }, { title: 'Apply and verify' }],
}

const P = 'agent-loop/pipelines/entity-scaffold'
const RAW_ARGS = args || ''
const MAX_ATTEMPTS = 4
const MAX_AGENT_CALLS = 7
const TOKEN_CEILING = 60000
// ponytail: the Workflow runtime bans Date.now()/new Date() (they break resume) and exposes no
// clock, so the 75-minute wall-clock window is not implementable here. pipeline.md already names
// the agent-call cap as the enforceable local proxy; it is now joined by the runtime's real token
// budget (the ceiling pipeline.md said "a future dispatcher must enforce at launch").

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
  // budget.total is null unless the caller set a token target; then remaining() is Infinity and
  // this term is a no-op. When a target is set, respect the declared token ceiling too.
  const declaredCeiling = Math.min(TOKEN_CEILING, budget.total || TOKEN_CEILING)
  const withinTokens = !budget.total || budget.spent() < declaredCeiling
  return withinAgentCalls && withinTokens
}

function recordAgentCall() {
  if (!budgetAvailable()) {
    throw new Error('entity-scaffold stopped at its runtime or agent-call bound')
  }
  agentCalls += 1
}

const TICKET = ticketPath()
const RESUME_RUN = optionValue('--resume=')
const PLAN_APPROVED = hasFlag('--approved-plan')
const MIGRATION_APPROVED = hasFlag('--approved-migration')

const SCOPE = {
  type: 'object',
  required: ['scope', 'runId', 'attempts', 'repeatCount'],
  properties: {
    scope: { enum: ['accept', 'refuse'] },
    runId: { type: 'string' },
    entityName: { type: 'string' },
    testPaths: { type: 'string' },
    attempts: { type: 'number' },
    lastFailure: { type: 'string' },
    repeatCount: { type: 'number' },
    reason: { type: 'string' },
  },
}

const PLAN = {
  type: 'object',
  required: ['planReady', 'rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    planReady: { type: 'boolean' },
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  },
}

const PREPARED = {
  type: 'object',
  required: ['prepared', 'migrationPath', 'migrationSha256'],
  properties: {
    prepared: { type: 'boolean' },
    migrationPath: { type: 'string' },
    migrationSha256: { type: 'string' },
    reason: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: [
    'verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid',
    'contractGreen', 'layersComplete', 'migrationSafe', 'dbCheckPasses',
    'isolationPasses', 'dbCrudPasses', 'cleanupPasses', 'suiteGreen', 'tscErrors',
    'eslintStart', 'eslintCurrent',
  ],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    contractGreen: { type: 'boolean' },
    layersComplete: { type: 'boolean' },
    migrationSafe: { type: 'boolean' },
    dbCheckPasses: { type: 'boolean' },
    isolationPasses: { type: 'boolean' },
    dbCrudPasses: { type: 'boolean' },
    cleanupPasses: { type: 'boolean' },
    suiteGreen: { type: 'boolean' },
    tscErrors: { type: 'number' },
    eslintStart: { type: 'number' },
    eslintCurrent: { type: 'number' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  },
}

if (!TICKET && !RESUME_RUN) {
  log('STOP: pass an approved entity ticket path, or --resume=<run-id>.')
  return { built: false, reason: 'missing ticket or run id' }
}

if ((PLAN_APPROVED || MIGRATION_APPROVED) && !RESUME_RUN) {
  log('STOP: approval flags require --resume=<run-id> from the matching training run.')
  return { built: false, reason: 'approval has no prior run' }
}

if (MIGRATION_APPROVED && !PLAN_APPROVED) {
  log('STOP: migration approval also requires the approved Plan for the same run.')
  return { built: false, reason: 'migration approved without plan approval' }
}

log(`bounds: ${MAX_ATTEMPTS} attempts · ${MAX_AGENT_CALLS} agent calls · ${TOKEN_CEILING} declared tokens`)

phase('Scope and plan')
recordAgentCall()
const scope = await agent(
  RESUME_RUN
    ? `You are the EXPLORE stage resuming entity-scaffold run ${RESUME_RUN}. Follow ${P}/explore.md.
       Read existing run notes only. Return the stored scope verdict, entity name, test paths,
       completed DB-apply attempt count, last verifier failure signature, and consecutive repeat
       count. Use runId ${RESUME_RUN}; do not change tests, notes, or mint a new run-id.`
    : `You are the EXPLORE stage of entity-scaffold. Follow ${P}/explore.md.
       Ticket: ${TICKET}. Mint one shared run-id with \`date "+%Y-%m-%d-%H%M%S"\`, create
       ${P}/runs/<run-id>, apply the scope gate, and write focused tests only when accepted.
       Return scope, runId, entityName, testPaths, attempts=0, lastFailure='', repeatCount=0,
       and reason.`,
  { label: 'explore', schema: SCOPE },
)

if (scope.scope === 'refuse') {
  log(`STOP: scope refused — ${scope.reason}`)
  return { built: false, refused: true, reason: scope.reason, runId: scope.runId }
}

if (scope.attempts >= MAX_ATTEMPTS) {
  log(`STOP: run ${scope.runId} reached its ${MAX_ATTEMPTS}-attempt bound.`)
  return { built: false, attempts: scope.attempts, runId: scope.runId }
}

const RUN = RESUME_RUN || scope.runId

recordAgentCall()
const plan = await agent(
  PLAN_APPROVED
    ? `You are the PLAN checkpoint for entity-scaffold run ${RUN}. Follow ${P}/plan.md.
       Read the existing ${P}/runs/${RUN}/plan.md. Return planReady=true only if that exact file
       exists, is complete, is consistent with Explore, and contains a valid 100-point Eval
       rubric. Return rubricReady, passThreshold, and the SHA-256 of the exact rubric section.
       Do not alter the approved plan.`
    : `You are the PLAN stage. Follow ${P}/plan.md. Read ${P}/runs/${RUN}/explore.md and write
       the exact plan and task-specific 100-point Eval rubric to ${P}/runs/${RUN}/plan.md. Hash
       the exact rubric section with SHA-256. Do not edit source or tests. Return planReady,
       rubricReady, passThreshold, rubricSha256, and whether the plan is ready for human review.`,
  { label: 'plan', phase: 'Scope and plan', schema: PLAN },
)

if (!plan.planReady || !plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
  log(`STOP: Plan is incomplete — ${plan.reason || 'see run notes'}`)
  return { built: false, reason: plan.reason, runId: RUN }
}

if (!PLAN_APPROVED) {
  log(`TRAINING STOP: review ${P}/runs/${RUN}/plan.md, then resume with --resume=${RUN} --approved-plan.`)
  return { built: false, awaitingPlanApproval: true, runId: RUN }
}

if (!MIGRATION_APPROVED) {
  phase('Prepare migration')
  recordAgentCall()
  const prepared = await agent(
    `You are EXECUTE Phase A, the maker. Follow ${P}/execute.md and the approved plan at
     ${P}/runs/${RUN}/plan.md. Build the scaffold and generate the migration, then STOP before
     applying it or running DB writes. Record the exact migration path, its SHA-256 digest,
     and migration-status: awaiting-approval in execute.md. Do not change Explore's tests.`,
    { label: 'execute-prepare', phase: 'Prepare migration', schema: PREPARED, model: 'opus' },
  )

  if (!prepared.prepared || !prepared.migrationPath || !prepared.migrationSha256) {
    log(`STOP: migration preparation failed — ${prepared.reason || 'see execute notes'}`)
    return { built: false, reason: prepared.reason, runId: RUN }
  }

  log(`MIGRATION STOP: inspect ${prepared.migrationPath} at SHA-256 ${prepared.migrationSha256}, then resume with --resume=${RUN} --approved-plan --approved-migration.`)
  return {
    built: false,
    awaitingMigrationApproval: true,
    migrationPath: prepared.migrationPath,
    migrationSha256: prepared.migrationSha256,
    runId: RUN,
  }
}

phase('Apply and verify')
recordAgentCall()
const prepared = await agent(
  `You are a read-only migration checkpoint for entity-scaffold run ${RUN}. Read
   ${P}/runs/${RUN}/execute.md and the recorded migration. Return prepared=true and its exact
   path and recorded SHA-256 when the file exists, a fresh digest matches the recorded digest,
   and execute.md marks the migration either awaiting-approval OR already applied at that same
   digest. A matching-digest already-applied migration is safe to proceed with: this lets a run
   that applied cleanly but failed eval for a non-migration reason be re-verified without
   regenerating or re-approving the identical SQL. Return prepared=false only if the file is
   missing or the digest differs from the approved one. Do not edit or apply anything.`,
  { label: 'migration-checkpoint', phase: 'Apply and verify', schema: PREPARED },
)

if (!prepared.prepared || !prepared.migrationPath || !prepared.migrationSha256) {
  log(`STOP: approved migration cannot be found — ${prepared.reason || 'see execute notes'}`)
  return { built: false, reason: prepared.reason, runId: RUN }
}

const attempt = scope.attempts + 1

recordAgentCall()
await agent(
  `You are EXECUTE Phase B, the maker. Follow ${P}/execute.md for run ${RUN}. The human approved
   ${prepared.migrationPath} at SHA-256 ${prepared.migrationSha256}. Do not regenerate or edit
   source, tests, fixtures, snapshots, or SQL. Confirm the digest and development endpoint,
   apply this exact migration (db:migrate is idempotent — if execute.md shows it was already
   applied at this digest on a prior attempt, a "no pending migrations" / already-applied result
   is success, not a failure; do not re-create or alter anything), run schema assertion,
   seed, and focused DB checks, then append attempt ${attempt} evidence to execute.md. Never use
   production, seed:reset, or ALLOW_DESTRUCTIVE_DB=1.`,
  { label: `execute-apply#${attempt}`, phase: 'Apply and verify', model: 'opus' },
)

recordAgentCall()
const verdict = await agent(
  `You are EVAL, a fresh read-only verifier. Follow ${P}/eval.md. Verify run ${RUN}, attempt
   ${attempt}. Inspect the approved migration and run the unchanged focused tests and every
   global gate. Apply the approved rubric at SHA-256 ${plan.rubricSha256} and threshold
   ${plan.passThreshold}/100. Write ${P}/runs/${RUN}/eval.md and return score, passThreshold,
   criticalFailures, rubricValid, and evidence only. Do not fix or suggest fixes.`,
  { label: `eval#${attempt}`, phase: 'Apply and verify', schema: VERDICT, model: 'sonnet' },
)

const allChecksPass = verdict.verdict === 'pass'
  && verdict.rubricValid
  && verdict.passThreshold === plan.passThreshold
  && verdict.score >= plan.passThreshold
  && verdict.criticalFailures === 0
  && verdict.contractGreen
  && verdict.layersComplete
  && verdict.migrationSafe
  && verdict.dbCheckPasses
  && verdict.isolationPasses
  && verdict.dbCrudPasses
  && verdict.cleanupPasses
  && verdict.suiteGreen
  && verdict.tscErrors === 0
  && verdict.eslintCurrent <= verdict.eslintStart

if (allChecksPass) {
  log(`DONE: ${scope.entityName} scaffold passed independent verification.`)
  return { built: true, entityName: scope.entityName, attempts: attempt, runId: RUN }
}

const failure = `score ${verdict.score}/${plan.passThreshold}, critical failures ${verdict.criticalFailures}: ${verdict.reason || verdict.evidence || 'verification failed'}`
const repeatCount = failure === scope.lastFailure ? scope.repeatCount + 1 : 1

if (!budgetAvailable()) {
  log('STOP: eval failed and this invocation reached its runtime or agent-call bound.')
  return { built: false, attempts: attempt, runId: RUN }
}

recordAgentCall()
await agent(
  `You are the failure-memory recorder for entity-scaffold run ${RUN}, attempt ${attempt}.
   Append one factual entry to agent-loop/memory/errors.md using its existing Symptom / Cause /
   Fix / Prevention format. The verifier failure was: ${failure}. If the cause is not proven,
   say it is not established; do not speculate and do not edit any other file.`,
  { label: `memory#${attempt}`, phase: 'Apply and verify' },
)

if (repeatCount >= 2) {
  log(`STOP: no progress after the same verifier failure repeated twice — ${failure}`)
  return { built: false, noProgress: true, attempts: attempt, runId: RUN }
}

recordAgentCall()
await agent(
  `You are PLAN after a failed entity-scaffold eval. Follow ${P}/plan.md. Run ${RUN}, attempt
   ${attempt}, failed with: ${failure}. Write a revised plan to ${P}/runs/${RUN}/plan.md and
   record lastFailure=${failure} with repeatCount=${repeatCount}. Do not edit source or tests.
   Preserve the Eval rubric byte-for-byte unless the revision explicitly proposes a rubric
   change for human approval. Return planReady, rubricReady, passThreshold, and rubricSha256.
   The revised plan requires a new human approval before Execute resumes.`,
  { label: `replan#${attempt}`, phase: 'Scope and plan', schema: PLAN },
)

log(`EVAL FAIL: review the revised plan, then resume run ${RUN} with --approved-plan. A new migration approval will also be required.`)
return { built: false, awaitingPlanApproval: true, attempts: attempt, runId: RUN }
