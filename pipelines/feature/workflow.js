// feature — automated pipeline runtime (built-in Workflow, no external deps).
// Pattern: specify with failing acceptance tests (explore) → plan → execute → eval, looped
// until the acceptance tests go green with no regressions. maker (execute) != verifier
// (eval); eval on a different model. A single runId is minted once and threaded through
// every stage (lesson from memory/errors.md — do not let stages invent their own).
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'feature',
  description: 'Turn a feature ticket into failing acceptance tests, build the smallest change that satisfies them, verify red-to-green',
  phases: [{ title: 'Specify' }, { title: 'Build loop' }],
}

const P = 'agent-loop/pipelines/feature'
const LINT = 'npx eslint app lib components'
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code, so the
// session is Claude). Pass `--provider=gpt` in args to route every stage to codex
// (gpt-5.1-codex-max), effort as the cheap→deep gradient. READ=explore/plan, MAKE=execute,
// VERIFY=eval (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TICKET = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: feature)'
const MAX = 6

const SPEC = { type: 'object', required: ['specified', 'runId'],
  properties: {
    specified: { type: 'boolean' },
    runId: { type: 'string' },
    testPath: { type: 'string' },
    criteria: { type: 'string' },
    note: { type: 'string' },
  } }

const PLAN = { type: 'object', required: ['rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  } }

const VERDICT = { type: 'object', required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256', 'acceptancePasses', 'suiteGreen', 'tscErrors', 'noNewEslintWarnings'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    acceptancePasses: { type: 'boolean' },
    suiteGreen: { type: 'boolean' },
    tscErrors: { type: 'number' },
    noNewEslintWarnings: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Specify')
const spec = await agent(
  `You are the EXPLORE stage of the feature pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\` to orient before reading code. Extract the ticket's acceptance
   criteria and write FAILING acceptance test(s) that encode them (confirm they are red for
   the right reason — the feature is missing). Return specified, runId, testPath, and a
   one-line criteria summary. If the criteria are ambiguous, set specified=false and explain
   in note — do not invent product behavior.`,
  { label: 'explore', schema: SPEC, ...TIER.read })

if (!spec.specified) {
  log(`STOP: could not specify — ${spec.note || 'see explore notes'}. Ticket goes back for clarification.`)
  return { specified: false, note: spec.note }
}

const RUN = spec.runId
log(`run ${RUN} — specified. acceptance tests: ${spec.testPath}`)

phase('Build loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Acceptance criteria: ${spec.criteria}. Failing tests: ${spec.testPath}.
     ${last ? `Previous attempt failed: ${last}. Adjust.` : ''}
     Plan the smallest build that makes the acceptance tests pass. Create the task-specific
     100-point Eval rubric required by plan.md. Hash the exact Eval-rubric section with SHA-256
     and return rubricReady, passThreshold, and rubricSha256. On retries, keep that section
     byte-for-byte unchanged unless a human approved a rubric change.`,
    { label: `plan#${i}`, phase: 'Build loop', schema: PLAN, ...TIER.read })

  if (!plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${plan.reason || 'see plan.md'}`)
    return { built: false, invalidRubric: true, iterations: i, runId: RUN }
  }

  if (lockedRubricSha256 === null) {
    lockedRubricSha256 = plan.rubricSha256
    lockedPassThreshold = plan.passThreshold
  } else if (plan.rubricSha256 !== lockedRubricSha256 || plan.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval rubric or threshold changed after scoring began; human approval is required.')
    return { built: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\`. Build exactly what the plan describes. Do NOT modify the
     acceptance tests to make them pass. If the plan is wrong, stop and report — don't
     improvise.`,
    { label: `execute#${i}`, phase: 'Build loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Run the acceptance tests at
     ${spec.testPath} (must go green, unmodified), \`npx vitest run\` (whole suite green),
     \`npx tsc --noEmit\` (0 errors), and \`${LINT}\` (no new warnings). Return the verdict
     with cited evidence. Apply the locked rubric at SHA-256 ${lockedRubricSha256} and threshold
     ${lockedPassThreshold}/100. Return score, passThreshold, criticalFailures, rubricValid,
     rubricSha256, noNewEslintWarnings, and cited evidence.`,
    { label: `eval#${i}`, phase: 'Build loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · acceptance ${v.acceptancePasses ? 'green' : 'RED'} · suite ${v.suiteGreen ? 'green' : 'RED'} · tsc ${v.tscErrors} · eslint ${v.noNewEslintWarnings ? 'no-new-warnings' : 'REGRESSED'}`)

  if (v.rubricSha256 !== lockedRubricSha256 || v.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval observed a changed rubric fingerprint or threshold; human approval is required.')
    return { built: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  if (v.verdict === 'pass' && v.rubricValid && v.rubricSha256 === lockedRubricSha256 && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.acceptancePasses && v.suiteGreen && v.tscErrors === 0 && v.noNewEslintWarnings) {
    log(`DONE: feature built and guarded by ${spec.testPath}`)
    return { built: true, iterations: i, testPath: spec.testPath, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'} · lint ${v.noNewEslintWarnings ? 'unchanged' : 'regressed'} · evidence ${v.evidence || 'none cited'}`
}

log(`STOP: not built within ${MAX} iterations — handing back to a human.`)
return { built: false, iterations: i, runId: RUN }
