// bug-fix — automated pipeline runtime (built-in Workflow, no external deps).
// Pattern: reproduce with a failing test (explore) → plan → execute → eval, looped until the
// new test goes green with no regressions. maker (execute) != verifier (eval); eval on a
// different model. A single runId is minted once and threaded through every stage
// (lesson from memory/errors.md — do not let stages invent their own).
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'bug-fix',
  description: 'Reproduce a bug with a failing test, fix the root cause, guard it with the test',
  phases: [{ title: 'Reproduce' }, { title: 'Fix loop' }],
}

const P = 'agent-loop/pipelines/bug-fix'
const LINT = 'npx eslint app lib components'
const MAX = 6
const SHA256 = /^[a-f0-9]{64}$/i

// Provider-adaptive model tiers. Default = Anthropic (the loop runs under Claude Code, so the
// session is Claude). Pass `--provider=gpt` in args to route every stage to codex
// (gpt-5.1-codex-max) instead — one GPT model, effort as the cheap→deep gradient. READ = explore
// /plan, MAKE = execute (the maker), VERIFY = eval (a separate agent either way, so maker!=verifier
// holds; on GPT it's the same model in a fresh context rather than a different model).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TICKET = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: bug)'

const REPRO = { type: 'object', required: ['reproduced', 'runId'],
  properties: {
    reproduced: { type: 'boolean' },
    runId: { type: 'string' },
    testPath: { type: 'string' },
    rootCause: { type: 'string' },
    note: { type: 'string' },
  } }

const PLAN = { type: 'object', required: ['rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  } }

const VERDICT = { type: 'object', required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256', 'newTestPasses', 'suiteGreen', 'tscErrors', 'noNewEslintWarnings'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    newTestPasses: { type: 'boolean' },
    suiteGreen: { type: 'boolean' },
    tscErrors: { type: 'number' },
    noNewEslintWarnings: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Reproduce')
const repro = await agent(
  `You are the EXPLORE stage of the bug-fix pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\` to orient before reading code. Reproduce the bug and write a
   FAILING test that captures it (confirm it is red for the right reason). Locate the root
   cause. Return reproduced, runId, testPath, and rootCause. If you cannot reproduce it, set
   reproduced=false and explain in note.`,
  { label: 'explore', schema: REPRO, ...TIER.read })

if (!repro.reproduced) {
  log(`STOP: could not reproduce — ${repro.note || 'see explore notes'}. Not a verifiable bug yet.`)
  return { reproduced: false, note: repro.note }
}

const RUN = repro.runId
log(`run ${RUN} — reproduced. failing test: ${repro.testPath}`)

phase('Fix loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Root cause so far: ${repro.rootCause}. Failing test: ${repro.testPath}.
     ${last ? `Previous attempt failed: ${last}. Adjust.` : ''}
     Plan the smallest root-cause fix that makes the failing test pass. Create the task-specific
     100-point Eval rubric required by plan.md. Hash the exact Eval-rubric section with SHA-256
     and return rubricReady, passThreshold, and rubricSha256. Preserve it byte-for-byte on retry.`,
    { label: `plan#${i}`, phase: 'Fix loop', schema: PLAN, ...TIER.read })

  if (!plan.rubricReady || !SHA256.test(plan.rubricSha256) || plan.passThreshold < 80 || plan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${plan.reason || 'see plan.md'}`)
    return { fixed: false, invalidRubric: true, iterations: i, runId: RUN }
  }

  if (lockedRubricSha256 === null) {
    lockedRubricSha256 = plan.rubricSha256
    lockedPassThreshold = plan.passThreshold
  } else if (plan.rubricSha256 !== lockedRubricSha256 || plan.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval rubric or threshold changed after scoring began; human approval is required.')
    return { fixed: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\`. Apply exactly the planned fix at the root cause. Do NOT modify the
     failing test to make it pass. If the plan is wrong, stop and report — don't improvise.`,
    { label: `execute#${i}`, phase: 'Fix loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Run the new test at ${repro.testPath}
     (must go green, unmodified), \`npx vitest run\` (whole suite green), \`npx tsc --noEmit\`
     (0 errors), and \`${LINT}\` (no new warnings). Apply the locked rubric at SHA-256
     ${lockedRubricSha256} and threshold ${lockedPassThreshold}/100. Return score,
     passThreshold, criticalFailures, rubricValid, rubricSha256, noNewEslintWarnings,
     and cited evidence.`,
    { label: `eval#${i}`, phase: 'Fix loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · newTest ${v.newTestPasses ? 'green' : 'RED'} · suite ${v.suiteGreen ? 'green' : 'RED'} · tsc ${v.tscErrors} · eslint ${v.noNewEslintWarnings ? 'no-new-warnings' : 'REGRESSED'}`)

  if (v.rubricSha256 !== lockedRubricSha256 || v.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval observed a changed rubric fingerprint or threshold; human approval is required.')
    return { fixed: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  if (v.verdict === 'pass' && v.rubricValid && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.newTestPasses && v.suiteGreen && v.tscErrors === 0 && v.noNewEslintWarnings) {
    log(`DONE: bug fixed and guarded by ${repro.testPath}`)
    return { fixed: true, iterations: i, testPath: repro.testPath, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}, eslint ${v.noNewEslintWarnings ? 'unchanged' : 'regressed'}: ${v.reason || v.evidence || 'checks failed'}`
}

log(`STOP: not fixed within ${MAX} iterations — handing back to a human.`)
return { fixed: false, iterations: i, runId: RUN }
