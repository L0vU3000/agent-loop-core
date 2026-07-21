// eslint-burndown — automated pipeline runtime (built-in Workflow, no external deps).
// Same four stages as the by-hand run: explore → (plan → execute → eval) looped.
// Control flow (when to loop / when to stop) is CODE. Judgment inside each stage is AGENTS.
// maker ≠ verifier: `execute` and `eval` are separate agent() calls; eval runs on a
// different model for extra separation.

export const meta = {
  name: 'eslint-burndown',
  description: 'Drive ESLint warnings down without breaking tsc or tests',
  phases: [{ title: 'Explore' }, { title: 'Burndown loop' }],
}

const LINT = 'npx eslint app lib components'
const P = 'agent-loop/pipelines/eslint-burndown'
const MAX = 6 // bound: never runs forever

// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code, so the
// session is Claude). Pass `--provider=gpt` in args to route every stage to codex
// (gpt-5.1-codex-max), effort as the cheap→deep gradient. READ=explore/plan, MAKE=execute,
// VERIFY=eval (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const COUNT = { type: 'object', required: ['startCount', 'runId'],
  properties: { startCount: { type: 'number' }, runId: { type: 'string' } } }

const PLAN = { type: 'object', required: ['hasSafeBatch', 'batchDescription', 'rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    hasSafeBatch: { type: 'boolean' },
    batchSize: { type: 'number' },
    batchDescription: { type: 'string' },
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  } }

const VERDICT = { type: 'object', required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'eslintCount', 'tscErrors', 'testsPass'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    eslintCount: { type: 'number' },
    tscErrors: { type: 'number' },
    testsPass: { type: 'boolean' },
    evidence: { type: 'string' },
  } }

phase('Explore')
const explore = await agent(
  `You are the EXPLORE stage. Follow ${P}/explore.md exactly.
   First, mint ONE run-id for this whole pipeline execution: \`date "+%Y-%m-%d-%H%M%S"\`, and
   \`mkdir -p ${P}/runs/<run-id>\`. Every later stage writes ONLY into that same folder.
   Then run \`${LINT}\`, report the starting warning count (use eslint's own summary total,
   not a grep of the word "warning"), and categorize warnings (mechanical/intentional/symptom).
   Return startCount and the runId you created.`,
  { label: 'explore', schema: COUNT, ...TIER.read })

const RUN = explore.runId
log(`run ${RUN} — start: ${explore.startCount} warnings`)

phase('Burndown loop')
let current = explore.startCount
let i = 0

while (current > 0 && i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Current eslint count is ${current}.
     Pick the next small batch of ONLY unambiguous unused imports. DEFER every
     symptom/intentional/behavior-changing warning: NOT_IMPLEMENTED_UNTIL_B6 markers,
     scoped* ownership helpers (possible IDOR symptom), unused params, unused useState,
     react-hooks/exhaustive-deps, next/no-img-element, no-unused-expressions.
     If no safe mechanical batch remains, set hasSafeBatch=false. Otherwise create the batch's
     task-specific 100-point Eval rubric required by plan.md, hash its exact section with SHA-256,
     and return rubricReady, passThreshold, and rubricSha256.`,
    { label: `plan#${i}`, phase: 'Burndown loop', schema: PLAN, ...TIER.read })

  if (!plan.hasSafeBatch) {
    log('STOP: no safe batch left — remaining warnings need human decisions.')
    break
  }

  if (!plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${plan.reason || 'see plan.md'}`)
    break
  }

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\`. Apply exactly this batch and nothing else: ${plan.batchDescription}.
     Stay strictly in scope — remove only the named unused imports; no refactors, no logic
     changes, no touching deferred items.`,
    { label: `execute#${i}`, phase: 'Burndown loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\` (overwrite each iteration is fine).
     Run \`${LINT}\`, \`npx tsc --noEmit\`, and \`npx vitest run\`. This iteration started at
     ${current} warnings. Return the verdict with real numbers and cited evidence. Do NOT
     suggest fixes — only rule pass/fail. Apply the batch rubric at SHA-256 ${plan.rubricSha256}
     and threshold ${plan.passThreshold}/100. Return score, passThreshold, criticalFailures,
     and rubricValid.`,
    { label: `eval#${i}`, phase: 'Burndown loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · eslint ${current}→${v.eslintCount} · tsc ${v.tscErrors} · tests ${v.testsPass ? 'green' : 'RED'}`)

  // guardrail: never trade green tests for a lower lint count
  if (v.verdict === 'fail' || !v.rubricValid || v.passThreshold !== plan.passThreshold || v.score < plan.passThreshold || v.criticalFailures > 0 || v.tscErrors > 0 || !v.testsPass) {
    log(`STOP: regression — ${v.evidence || 'see eval'}. Human decides whether to revert.`)
    break
  }
  // loop-until-dry: nothing changed this pass
  if (v.eslintCount >= current) {
    log('STOP: no progress this iteration.')
    break
  }
  current = v.eslintCount
}

return { startCount: explore.startCount, finalCount: current, iterations: i }
