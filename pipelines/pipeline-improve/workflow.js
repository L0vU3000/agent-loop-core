// pipeline-improve — built-in Workflow runtime.
// Evidence selection → plan approval → one machinery change → independent verification.
// One shared run-id is threaded through every stage and retry.

export const meta = {
  name: 'pipeline-improve',
  description: 'Implement and independently prove one evidence-backed pipeline-system improvement',
  phases: [{ title: 'Select and plan' }, { title: 'Improve and verify' }],
}

const P = 'agent-loop/pipelines/pipeline-improve'
const RAW_ARGS = args || ''
const MAX_ATTEMPTS = 3
const MAX_AGENT_CALLS = 8
const TOKEN_CEILING = 45000
// ponytail: the Workflow runtime bans Date.now()/new Date() (they break resume) and exposes no
// clock, so the 45-minute wall-clock window is not implementable here. pipeline.md's agent-call
// cap is the enforceable local proxy, joined by the runtime's real token budget.

let agentCalls = 0

function hasArgument(argument) {
  return RAW_ARGS.split(/\s+/).includes(argument)
}

function optionValue(prefix) {
  const option = RAW_ARGS.split(/\s+/).find((part) => part.startsWith(prefix))
  return option ? option.slice(prefix.length) : ''
}

function callBudgetAvailable() {
  const withinCallCount = agentCalls < MAX_AGENT_CALLS
  // budget.total is null unless the caller set a token target; then remaining() is Infinity and
  // this term is a no-op. When a target is set, respect the declared token ceiling too.
  const declaredCeiling = Math.min(TOKEN_CEILING, budget.total || TOKEN_CEILING)
  const withinTokens = !budget.total || budget.spent() < declaredCeiling
  return withinCallCount && withinTokens
}

function recordAgentCall() {
  if (!callBudgetAvailable()) {
    throw new Error('pipeline-improve stopped at its runtime or agent-call bound')
  }
  agentCalls += 1
}

const RESUME_RUN = optionValue('--resume=')
const PLAN_APPROVED = hasArgument('--approved-plan')
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code, so the
// session is Claude). Pass `--provider=gpt` in args to route every stage to codex
// (gpt-5.1-codex-max), effort as the cheap→deep gradient. READ=explore/plan, MAKE=execute,
// VERIFY=eval (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(RAW_ARGS) ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const EVIDENCE_HINT = RAW_ARGS.replace(/\s*--provider=\S+/, '').trim()
  .split(/\s+/)
  .filter((part) => part && !part.startsWith('--'))
  .join(' ')

const EXPLORATION = {
  type: 'object',
  required: ['selected', 'runId', 'candidateId', 'improvement', 'focusedCommand', 'attempts', 'lastFailure', 'repeatCount', 'eslintBaseline'],
  properties: {
    selected: { type: 'boolean' },
    runId: { type: 'string' },
    candidateId: { type: 'string' },
    improvement: { type: 'string' },
    focusedCommand: { type: 'string' },
    attempts: { type: 'number' },
    lastFailure: { type: 'string' },
    repeatCount: { type: 'number' },
    // Independent ESLint warning baseline, captured before any change — so the "ESLint did not
    // regress" gate compares against Explore's number, never a figure the verifier can inflate.
    eslintBaseline: { type: 'number' },
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

const EXECUTION = {
  type: 'object',
  required: ['implemented', 'improvementCount', 'focusedCheckPasses'],
  properties: {
    implemented: { type: 'boolean' },
    improvementCount: { type: 'number' },
    focusedCheckPasses: { type: 'boolean' },
    changedFiles: { type: 'string' },
    reason: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'improvementCount', 'focusedRedGreen', 'machineryPasses', 'suiteGreen', 'tscErrors', 'eslintStart', 'eslintCurrent', 'guardsPreserved'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    improvementCount: { type: 'number' },
    focusedRedGreen: { type: 'boolean' },
    machineryPasses: { type: 'boolean' },
    suiteGreen: { type: 'boolean' },
    tscErrors: { type: 'number' },
    eslintStart: { type: 'number' },
    eslintCurrent: { type: 'number' },
    guardsPreserved: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  },
}

// Second, independent source for the objective gates. workflow.js runs in the Workflow sandbox
// (no shell), so it cannot run the commands itself — the closest enforceable design is a separate
// agent whose ONLY job is to run them and report raw results, then fail the run on any mismatch
// with the Eval agent's self-report (fail-closed corroboration, not single-source trust).
const GATES = {
  type: 'object',
  required: ['machineryPasses', 'vitestPassed', 'vitestTotal', 'tscErrors', 'eslintCount'],
  properties: {
    machineryPasses: { type: 'boolean' },
    vitestPassed: { type: 'number' },
    vitestTotal: { type: 'number' },
    tscErrors: { type: 'number' },
    eslintCount: { type: 'number' },
    evidence: { type: 'string' },
  },
}

if (PLAN_APPROVED && !RESUME_RUN) {
  log('STOP: --approved-plan requires --resume=<run-id> from the matching Plan.')
  return { improved: false, reason: 'approval has no prior run' }
}

log(`bounds: ${MAX_ATTEMPTS} attempts · ${MAX_AGENT_CALLS} agent calls · ${TOKEN_CEILING} declared tokens`)

phase('Select and plan')
recordAgentCall()
const exploration = await agent(
  RESUME_RUN
    ? `You are the read-only EXPLORE checkpoint resuming pipeline-improve run ${RESUME_RUN}.
       Follow ${P}/explore.md. Read the existing run notes and latest eval only. Return the
       stored candidate, focused command, completed attempt count, last failure signature,
       repeat count, and the eslintBaseline recorded in explore.md. Use runId ${RESUME_RUN};
       do not edit tracked files or mint a new run-id.`
    : `You are the read-only EXPLORE stage of pipeline-improve. Follow ${P}/explore.md.
       Evidence hint: ${EVIDENCE_HINT || '(none; rank memory and recent run evidence)'}.
       Read agent-loop memory and recent eval evidence. Select exactly one reproducible
       machinery weakness. Capture the starting ESLint warning count for \`app lib components\`.
       Mint one shared run-id with \`date "+%Y-%m-%d-%H%M%S"\`, create ${P}/runs/<run-id>, and
       write explore.md only. Return selected, runId, candidateId, improvement, focusedCommand,
       attempts=0, lastFailure='', repeatCount=0, eslintBaseline, and reason.`,
  { label: 'explore', schema: EXPLORATION, ...TIER.read },
)

if (!exploration.selected) {
  log(`STOP: no evidence-backed machinery improvement — ${exploration.reason || 'see Explore notes'}`)
  return { improved: false, reason: exploration.reason, runId: exploration.runId }
}

if (exploration.attempts >= MAX_ATTEMPTS) {
  log(`STOP: run ${exploration.runId} reached its ${MAX_ATTEMPTS}-attempt bound.`)
  return { improved: false, attempts: exploration.attempts, runId: exploration.runId }
}

const RUN = RESUME_RUN || exploration.runId

recordAgentCall()
const plan = await agent(
  PLAN_APPROVED
    ? `You are the PLAN approval checkpoint for pipeline-improve run ${RUN}. Follow
       ${P}/plan.md. Read the existing plan.md and return planReady=true only when it names
       one improvement, exact files, a deterministic red-to-green check, preserved gates, and
       a valid 100-point Eval rubric. Return rubricReady, passThreshold, and the SHA-256 of the
       exact rubric section. Do not edit the approved plan or tracked files.`
    : `You are the read-only PLAN stage. Follow ${P}/plan.md. Read
       ${P}/runs/${RUN}/explore.md and write the exact one-improvement plan to
       ${P}/runs/${RUN}/plan.md, including its task-specific 100-point Eval rubric. Hash the exact
       rubric section with SHA-256. Do not edit tracked files. Return planReady, rubricReady,
       passThreshold, rubricSha256, and whether the Plan is ready for human review.`,
  { label: 'plan', phase: 'Select and plan', schema: PLAN, ...TIER.read },
)

if (!plan.planReady || !plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
  log(`STOP: Plan is incomplete — ${plan.reason || 'see run notes'}`)
  return { improved: false, reason: plan.reason, runId: RUN }
}

if (!PLAN_APPROVED) {
  log(`TRAINING STOP: review ${P}/runs/${RUN}/plan.md, then resume with --resume=${RUN} --approved-plan.`)
  return { improved: false, awaitingPlanApproval: true, runId: RUN }
}

phase('Improve and verify')
const attempt = exploration.attempts + 1

recordAgentCall()
const execution = await agent(
  `You are EXECUTE, the maker for pipeline-improve run ${RUN}, attempt ${attempt}. Follow
   ${P}/execute.md and the approved plan.md. Implement exactly one improvement and its focused
   regression check. Do not commit, touch product/database code, weaken any gate, or add another
   pipeline. Write execute.md and return implemented, improvementCount, focusedCheckPasses,
   changedFiles, and reason.`,
  { label: `execute#${attempt}`, phase: 'Improve and verify', schema: EXECUTION, ...TIER.make },
)

if (!execution.implemented || execution.improvementCount !== 1) {
  log(`STOP: Execute did not produce exactly one improvement — ${execution.reason || 'see execute.md'}`)
  return { improved: false, attempts: attempt, runId: RUN }
}

recordAgentCall()
const verdict = await agent(
  `You are EVAL, a fresh read-only verifier for pipeline-improve run ${RUN}, attempt ${attempt}.
   Follow ${P}/eval.md. Inspect the approved Plan and diff. Run ${exploration.focusedCommand},
   check-machinery.sh, full Vitest, TypeScript, and ESLint. Write eval.md and return evidence
   only. Apply the approved rubric at SHA-256 ${plan.rubricSha256} and threshold
   ${plan.passThreshold}/100. Return score, passThreshold, criticalFailures, rubricValid, and
   the normal evidence. Do not edit or suggest repairs.`,
  { label: `eval#${attempt}`, phase: 'Improve and verify', schema: VERDICT, ...TIER.verify },
)

// Independent gate runner — a THIRD agent (separate from maker and rubric-verifier) that only
// runs the four objective commands and reports raw results. The verdict below trusts THESE
// numbers for the mechanical gates, and separately requires the Eval agent's self-report to
// agree with them; a disagreement means one agent did not actually run the gate, so we fail.
recordAgentCall()
const gates = await agent(
  `You are the GATE RUNNER for pipeline-improve run ${RUN}, attempt ${attempt} — a mechanical
   executor, not a judge. From the repo root run these EXACT commands and report only what they
   produce. Make no rubric judgment and edit nothing:
     1. bash agent-loop/scripts/check-machinery.sh   → machineryPasses = every line ok and exit 0
     2. npx vitest run                                → vitestPassed / vitestTotal
     3. npx tsc --noEmit                              → tscErrors = error count (0 if clean)
     4. npx eslint app lib components                 → eslintCount = total warnings + errors
   Return machineryPasses, vitestPassed, vitestTotal, tscErrors, eslintCount, and the raw
   command evidence. You are an independent second source; do not read the Eval agent's notes.`,
  { label: `gates#${attempt}`, phase: 'Improve and verify', schema: GATES, ...TIER.verify },
)

// Objective gates — sourced from the independent gate runner, not the rubric verifier. ESLint is
// compared against Explore's pre-change baseline so the count can't be quietly rebased.
const objectiveGreen = gates.machineryPasses
  && gates.tscErrors === 0
  && gates.vitestTotal > 0
  && gates.vitestPassed === gates.vitestTotal
  && gates.eslintCount <= exploration.eslintBaseline

// Corroboration — the Eval agent independently ran the same gates; its self-report must match the
// gate runner. A mismatch is fail-closed: it means at least one of them did not really run them.
const evalCorroborates = verdict.machineryPasses === gates.machineryPasses
  && verdict.tscErrors === gates.tscErrors
  && verdict.suiteGreen === (gates.vitestPassed === gates.vitestTotal)

// Judgment gates stay with the rubric verifier — score, criticality, scope, the focused
// red→green proof, and that no guard was weakened.
const allChecksPass = verdict.verdict === 'pass'
  && verdict.rubricValid
  && verdict.passThreshold === plan.passThreshold
  && verdict.score >= plan.passThreshold
  && verdict.criticalFailures === 0
  && verdict.improvementCount === 1
  && verdict.focusedRedGreen
  && verdict.guardsPreserved
  && objectiveGreen
  && evalCorroborates

if (allChecksPass) {
  log(`DONE: ${exploration.candidateId} passed independent verification and gate corroboration.`)
  return { improved: true, improvement: exploration.improvement, attempts: attempt, runId: RUN }
}

const gateSummary = `gates[machinery ${gates.machineryPasses ? 'ok' : 'FAIL'}, `
  + `vitest ${gates.vitestPassed}/${gates.vitestTotal}, tsc ${gates.tscErrors}, `
  + `eslint ${gates.eslintCount}/${exploration.eslintBaseline}]${evalCorroborates ? '' : ' EVAL↔GATE MISMATCH'}`
const failure = `score ${verdict.score}/${plan.passThreshold}, critical failures ${verdict.criticalFailures}, `
  + `${gateSummary}: ${verdict.reason || verdict.evidence || 'verification failed'}`
const repeatCount = failure === exploration.lastFailure ? exploration.repeatCount + 1 : 1

if (!callBudgetAvailable()) {
  log('STOP: eval failed and this invocation reached its runtime or agent-call bound.')
  return { improved: false, attempts: attempt, runId: RUN }
}

recordAgentCall()
await agent(
  `You are the failure-memory recorder for pipeline-improve run ${RUN}, attempt ${attempt}.
   Append one factual entry to agent-loop/memory/errors.md using its Symptom / Cause / Fix /
   Prevention format. Failure: ${failure}. Keep an unproven cause explicitly unknown and edit
   no other file.`,
  { label: `memory#${attempt}`, phase: 'Improve and verify', ...TIER.read },
)

if (repeatCount >= 2) {
  log(`STOP: no progress after the same verifier failure repeated twice — ${failure}`)
  return { improved: false, noProgress: true, attempts: attempt, runId: RUN }
}

recordAgentCall()
await agent(
  `You are PLAN after failed Eval for pipeline-improve run ${RUN}, attempt ${attempt}. Follow
   ${P}/plan.md. Failure: ${failure}. Revise plan.md without changing the one selected
   improvement. Record attempts=${attempt}, lastFailure=${failure}, and
   repeatCount=${repeatCount}. Preserve the Eval rubric byte-for-byte unless the revision
   explicitly proposes a rubric change for human approval. Return planReady, rubricReady,
   passThreshold, and rubricSha256. Do not edit tracked files.`,
  { label: `replan#${attempt}`, phase: 'Select and plan', schema: PLAN, ...TIER.read },
)

log(`EVAL FAIL: review the revised Plan, then resume ${RUN} with --approved-plan.`)
return { improved: false, awaitingPlanApproval: true, attempts: attempt, runId: RUN }
