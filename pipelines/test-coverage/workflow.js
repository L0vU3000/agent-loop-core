// test-coverage — automated pipeline runtime (built-in Workflow, no external deps).
// Pattern: pick target + baseline (explore) → plan tests → write tests (execute) → eval,
// looped until coverage is up AND the mutation score meets the plan's threshold, with no
// regressions. maker (execute) != verifier (eval); eval on a different model. One runId is
// minted in explore and threaded through every stage (lesson from memory/errors.md).
//
// Optionally pass a target module as args, e.g.
// Workflow({scriptPath, args: 'lib/services/co-owners.ts'})

export const meta = {
  name: 'test-coverage',
  description: 'Write honest tests for an untested services module; verify with coverage + mutation score',
  phases: [{ title: 'Discover' }, { title: 'Test loop' }],
}

const P = 'agent-loop/pipelines/test-coverage'
const LINT = 'npx eslint app lib components'
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code, so the
// session is Claude). Pass `--provider=gpt` in args to route every stage to codex
// (gpt-5.1-codex-max), effort as the cheap→deep gradient. READ=explore/plan, MAKE=execute,
// VERIFY=eval (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TARGET_HINT = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no target passed — explore picks the highest-value untested lib/services module)'
const MAX = 5

const DISCOVERY = { type: 'object', required: ['viable', 'runId'],
  properties: {
    viable: { type: 'boolean' },
    runId: { type: 'string' },
    targetModule: { type: 'string' },
    baselineStatementPct: { type: 'number' },
    lane: { enum: ['default', 'live-db'] },
    note: { type: 'string' },
  } }

const PLAN = { type: 'object', required: ['rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  } }

const VERDICT = { type: 'object', required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'newTestsPass', 'coverageUp', 'mutationScore', 'suiteGreen', 'tscErrors'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    newTestsPass: { type: 'boolean' },
    coverageUp: { type: 'boolean' },
    mutationScore: { type: 'number' },
    suiteGreen: { type: 'boolean' },
    tscErrors: { type: 'number' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Discover')
const found = await agent(
  `You are the EXPLORE stage of the test-coverage pipeline. Follow ${P}/explore.md.
   Target hint: ${TARGET_HINT}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\` to orient before reading code. Record the target module, its
   baseline statement coverage (cite the coverage output), the chosen test lane, and the
   behaviors worth testing. If the live-db lane is chosen, confirm DATABASE_URL in
   .env.local is NOT the prod endpoint (ep-aged-cloud-*) and cite that check.
   If nothing is worth testing, set viable=false and explain in note.`,
  { label: 'explore', schema: DISCOVERY, ...TIER.read })

if (!found.viable) {
  log(`STOP: nothing to do — ${found.note || 'see explore notes'}.`)
  return { viable: false, note: found.note }
}

const RUN = found.runId
log(`run ${RUN} — target ${found.targetModule} (baseline ${found.baselineStatementPct}% statements, lane ${found.lane})`)

phase('Test loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Target: ${found.targetModule} (lane ${found.lane}, baseline ${found.baselineStatementPct}%).
     ${last ? `Previous attempt failed eval: ${last}. Adjust the plan.` : ''}
     Enumerate concrete test cases and commit to coverage + mutation-score thresholds. Create the
     task-specific 100-point Eval rubric required by plan.md, hash its exact section with SHA-256,
     and return rubricReady, passThreshold, and rubricSha256. Preserve it byte-for-byte on retry.`,
    { label: `plan#${i}`, phase: 'Test loop', schema: PLAN, ...TIER.read })

  if (!plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${plan.reason || 'see plan.md'}`)
    return { done: false, invalidRubric: true, iterations: i, runId: RUN }
  }

  if (lockedRubricSha256 === null) {
    lockedRubricSha256 = plan.rubricSha256
    lockedPassThreshold = plan.passThreshold
  } else if (plan.rubricSha256 !== lockedRubricSha256 || plan.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval rubric or threshold changed after scoring began; human approval is required.')
    return { done: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\` and the planned test file(s). Write exactly the planned tests.
     Do NOT change product code. Live-db lane: Neon dev branch only, create-then-clean-up,
     never seed:reset.`,
    { label: `execute#${i}`, phase: 'Test loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Checks: new tests pass · target-module
     coverage strictly above ${found.baselineStatementPct}% (npx vitest run --coverage) ·
     Stryker mutation score meets the plan's threshold (npx stryker run scoped to the target)
     · \`npx vitest run\` whole suite green · \`npx tsc --noEmit\` 0 errors · \`${LINT}\` no new
     warnings. Also run the anti-gaming checks in eval.md (assertion-free tests, maker touched
     product code). Apply the locked rubric at SHA-256 ${lockedRubricSha256} and threshold
     ${lockedPassThreshold}/100. Return score, passThreshold, criticalFailures, rubricValid, and
     cited evidence.`,
    { label: `eval#${i}`, phase: 'Test loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · tests ${v.newTestsPass ? 'green' : 'RED'} · coverage ${v.coverageUp ? 'up' : 'NOT up'} · mutation ${v.mutationScore}% · suite ${v.suiteGreen ? 'green' : 'RED'} · tsc ${v.tscErrors}`)

  if (v.verdict === 'pass' && v.rubricValid && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.newTestsPass && v.coverageUp && v.suiteGreen && v.tscErrors === 0) {
    log(`DONE: ${found.targetModule} tested — mutation score ${v.mutationScore}%`)
    return { done: true, iterations: i, targetModule: found.targetModule, mutationScore: v.mutationScore, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'}`
}

log(`STOP: threshold not met within ${MAX} iterations — handing back to a human.`)
return { done: false, iterations: i, runId: RUN }
