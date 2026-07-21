// e2e-regression — automated pipeline runtime (built-in Workflow, no external deps).
// Pattern: run the suite + classify failures by rerun (explore) → plan fixes/quarantines →
// execute → eval reruns everything (full suite twice), looped until green with every failure
// dispositioned. maker (execute) != verifier (eval); eval on a different model. One runId is
// minted in explore and threaded through every stage (lesson from memory/errors.md).

export const meta = {
  name: 'e2e-regression',
  description: 'Run the Playwright e2e suite, fix deterministic regressions, quarantine flakes',
  phases: [{ title: 'Triage' }, { title: 'Fix loop' }],
}

const P = 'agent-loop/pipelines/e2e-regression'
const LINT = 'npx eslint app lib components'
const MAX = 4

// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code, so the
// session is Claude). Pass `--provider=gpt` in args to route every stage to codex
// (gpt-5.1-codex-max), effort as the cheap→deep gradient. READ=explore/plan, MAKE=execute,
// VERIFY=eval (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TRIAGE = { type: 'object', required: ['runId', 'suiteGreen', 'regressionCount', 'flakeCount', 'ticketedQuarantinesUnskipped'],
  properties: {
    runId: { type: 'string' },
    suiteGreen: { type: 'boolean' },
    regressionCount: { type: 'number' },
    flakeCount: { type: 'number' },
    ticketedQuarantinesUnskipped: { type: 'boolean' },
    note: { type: 'string' },
  } }

const PLAN = { type: 'object', required: ['rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  } }

const VERDICT = { type: 'object', required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'regressionsFixed', 'twoGreenRuns', 'dispositionsComplete', 'tscErrors'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    regressionsFixed: { type: 'boolean' },
    twoGreenRuns: { type: 'boolean' },
    dispositionsComplete: { type: 'boolean' },
    tscErrors: { type: 'number' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Triage')
const triage = await agent(
  `You are the EXPLORE stage of the e2e-regression pipeline. Follow ${P}/explore.md.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Preflight: node >= 24, dev server (reuse 3002 or start \`npm run dev:e2e\` in background),
   .env.local not prod (ep-aged-cloud-*). Run the e2e suite once; rerun each failing spec up
   to 3x to classify regression vs flake; write the disposition table with trace evidence.
   Return runId, suiteGreen, regressionCount, flakeCount.`,
  { label: 'explore', schema: TRIAGE, ...TIER.read })

const RUN = triage.runId

if (triage.suiteGreen && triage.ticketedQuarantinesUnskipped) {
  const cleanPlan = await agent(
    `You are the PLAN stage for a verification-only e2e-regression run. Follow ${P}/plan.md.
     Write \`${P}/runs/${RUN}/plan.md\` with no product/spec changes and a task-specific
     100-point Eval rubric covering two consecutive green full-suite runs, disposition integrity,
     anti-gaming, Vitest, TypeScript, and ESLint. Hash the exact Eval-rubric section with SHA-256
     and return rubricReady, passThreshold, and rubricSha256.`,
    { label: 'plan-clean', schema: PLAN, ...TIER.read })

  if (!cleanPlan.rubricReady || !cleanPlan.rubricSha256 || cleanPlan.passThreshold < 80 || cleanPlan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${cleanPlan.reason || 'see plan.md'}`)
    return { clean: false, invalidRubric: true, runId: RUN }
  }

  const cleanVerdict = await agent(
    `You are the EVAL stage, a fresh independent verifier. Follow ${P}/eval.md. Write
     \`${P}/runs/${RUN}/eval.md\`. Run the full e2e suite twice consecutively plus every global
     gate and anti-gaming check. Apply the Plan rubric at SHA-256 ${cleanPlan.rubricSha256} and
     threshold ${cleanPlan.passThreshold}/100. Return score, passThreshold, criticalFailures,
     rubricValid, and the normal structured verdict evidence.`,
    { label: 'eval-clean', schema: VERDICT, ...TIER.verify })

  const clean = cleanVerdict.verdict === 'pass' && cleanVerdict.rubricValid &&
    cleanVerdict.passThreshold === cleanPlan.passThreshold &&
    cleanVerdict.score >= cleanPlan.passThreshold && cleanVerdict.criticalFailures === 0 &&
    cleanVerdict.regressionsFixed && cleanVerdict.twoGreenRuns &&
    cleanVerdict.dispositionsComplete && cleanVerdict.tscErrors === 0
  log(`run ${RUN} — independently scored ${cleanVerdict.score}/${cleanPlan.passThreshold}; ${clean ? 'PASS' : 'FAIL'}.`)
  return { clean, score: cleanVerdict.score, runId: RUN }
}

if (triage.suiteGreen) {
  log(`run ${RUN} — suite is green but an open de-flake ticket's test is still skipped (ticketedQuarantinesUnskipped=false); refusing the clean path and entering the Fix loop to lift the quarantine.`)
}

log(`run ${RUN} — ${triage.regressionCount} regression(s), ${triage.flakeCount} flake(s). Entering fix loop.`)

phase('Fix loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Read the disposition table in \`${P}/runs/${RUN}/explore.md\`.
     ${last ? `Previous attempt failed eval: ${last}. Adjust.` : ''}
     Plan the smallest app-side fix per regression and the quarantine annotation + de-flake
     ticket per flake. Mark product-behavior questions as escalate. Create the task-specific
     100-point Eval rubric required by plan.md, hash its exact section with SHA-256, and return
     rubricReady, passThreshold, and rubricSha256. Preserve it byte-for-byte on retry.`,
    { label: `plan#${i}`, phase: 'Fix loop', schema: PLAN, ...TIER.read })

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
     \`${P}/runs/${RUN}/\`, the planned fix locations, and orchestrator/inbox/ (de-flake
     tickets). Apply exactly the plan. Never delete a test, never widen timeouts or loosen
     assertions to force a pass.`,
    { label: `execute#${i}`, phase: 'Fix loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Checks: each regression's spec passes ·
     full suite green TWICE consecutively · every failure dispositioned (fixed, or annotated
     skip + ticket file in orchestrator/inbox/) · \`npx vitest run\` green · \`npx tsc --noEmit\`
     0 · \`${LINT}\` no new warnings. Diff changed spec files for weakened assertions/widened
     timeouts (anti-gaming). Apply the locked rubric at SHA-256 ${lockedRubricSha256} and threshold
     ${lockedPassThreshold}/100. Return score, passThreshold, criticalFailures, rubricValid,
     and cited evidence.`,
    { label: `eval#${i}`, phase: 'Fix loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · regressions ${v.regressionsFixed ? 'fixed' : 'OPEN'} · 2x green ${v.twoGreenRuns ? 'yes' : 'NO'} · dispositions ${v.dispositionsComplete ? 'complete' : 'INCOMPLETE'} · tsc ${v.tscErrors}`)

  if (v.verdict === 'pass' && v.rubricValid && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.regressionsFixed && v.twoGreenRuns && v.dispositionsComplete && v.tscErrors === 0) {
    log(`DONE: suite trustworthy — green twice, every failure dispositioned.`)
    return { done: true, iterations: i, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'}`
}

log(`STOP: not stable within ${MAX} iterations — handing back to a human.`)
return { done: false, iterations: i, runId: RUN }
