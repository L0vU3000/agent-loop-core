import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const PIPELINES_ROOT = new URL('../pipelines/', import.meta.url)
const BUG_FIX_WORKFLOW = new URL('../pipelines/bug-fix/workflow.js', import.meta.url)
const FEATURE_WORKFLOW = new URL('../pipelines/feature/workflow.js', import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

const LOCKED_RUBRIC_SHA256 = 'a'.repeat(64)

function passingPlan(overrides = {}) {
  return {
    rubricReady: true,
    passThreshold: 85,
    rubricSha256: LOCKED_RUBRIC_SHA256,
    ...overrides,
  }
}

function passingVerdict(overrides = {}) {
  return {
    verdict: 'pass',
    score: 100,
    passThreshold: 85,
    criticalFailures: 0,
    rubricValid: true,
    rubricSha256: LOCKED_RUBRIC_SHA256,
    newTestPasses: true,
    suiteGreen: true,
    tscErrors: 0,
    noNewEslintWarnings: true,
    evidence: 'deterministic workflow harness',
    reason: 'all checks passed',
    ...overrides,
  }
}

function passingFeatureVerdict(overrides = {}) {
  return {
    verdict: 'pass',
    score: 100,
    passThreshold: 85,
    criticalFailures: 0,
    rubricValid: true,
    rubricSha256: LOCKED_RUBRIC_SHA256,
    acceptancePasses: true,
    suiteGreen: true,
    tscErrors: 0,
    noNewEslintWarnings: true,
    evidence: 'deterministic feature workflow harness',
    reason: 'all checks passed',
    ...overrides,
  }
}

async function runBugFixWorkflow({ plans = [passingPlan()], verdicts = [passingVerdict()] } = {}) {
  const source = await readFile(BUG_FIX_WORKFLOW, 'utf8')
  const executableSource = source.replace('export const meta', 'const meta')
  const events = []
  const logs = []
  let planIndex = 0
  let verdictIndex = 0

  async function agent(_prompt, options) {
    events.push(options.label)

    if (options.label === 'explore') {
      return {
        reproduced: true,
        runId: 'scoring-regression',
        testPath: 'agent-loop/scripts/check-eval-scoring.regression.mjs',
        rootCause: 'the workflow exit predicate trusts an incomplete Eval result',
      }
    }

    if (options.label.startsWith('plan#')) {
      const plan = plans[Math.min(planIndex, plans.length - 1)]
      planIndex += 1
      return plan
    }

    if (options.label.startsWith('execute#')) {
      return {}
    }

    if (options.label.startsWith('eval#')) {
      const verdict = verdicts[Math.min(verdictIndex, verdicts.length - 1)]
      verdictIndex += 1
      return verdict
    }

    throw new Error(`Unexpected agent label: ${options.label}`)
  }

  const executeWorkflow = new AsyncFunction('args', 'phase', 'agent', 'log', executableSource)
  const result = await executeWorkflow('', () => {}, agent, (message) => logs.push(message))

  return { events, logs, result }
}

async function runFeatureWorkflow({
  plans = [passingPlan()],
  verdicts = [passingFeatureVerdict()],
} = {}) {
  const source = await readFile(FEATURE_WORKFLOW, 'utf8')
  const executableSource = source.replace('export const meta', 'const meta')
  const events = []
  const logs = []
  const prompts = []
  let planIndex = 0
  let verdictIndex = 0

  async function agent(prompt, options) {
    events.push(options.label)
    prompts.push({ label: options.label, prompt })

    if (options.label === 'explore') {
      return {
        specified: true,
        runId: 'feature-scoring-regression',
        testPath: 'agent-loop/scripts/check-eval-scoring.regression.mjs',
        criteria: 'the feature workflow must enforce every critical Eval fact',
      }
    }

    if (options.label.startsWith('plan#')) {
      const plan = plans[Math.min(planIndex, plans.length - 1)]
      planIndex += 1
      return plan
    }

    if (options.label.startsWith('execute#')) {
      return {}
    }

    if (options.label.startsWith('eval#')) {
      const verdict = verdicts[Math.min(verdictIndex, verdicts.length - 1)]
      verdictIndex += 1
      return verdict
    }

    throw new Error(`Unexpected agent label: ${options.label}`)
  }

  const executeWorkflow = new AsyncFunction('args', 'phase', 'agent', 'log', executableSource)
  const result = await executeWorkflow('', () => {}, agent, (message) => logs.push(message))

  return { events, logs, prompts, result }
}

async function registeredPipelineNames() {
  const entries = await readdir(PIPELINES_ROOT, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

async function readPipelineFile(pipelineName, fileName) {
  const fileUrl = new URL(`${pipelineName}/${fileName}`, PIPELINES_ROOT)
  return readFile(fileUrl, 'utf8')
}

test('shared Eval guide defines the score and critical-failure decision', async () => {
  const guide = await readFile(new URL('EVAL.md', PIPELINES_ROOT), 'utf8')

  assert.match(guide, /score >= Plan threshold/)
  assert.match(guide, /critical failures = 0/)
  assert.match(guide, /weights are whole numbers and must total exactly 100/i)
  assert.match(guide, /rubricSha256|SHA-256/)
})

test('every pipeline plans, reports, and enforces task-specific scoring', async () => {
  const pipelineNames = await registeredPipelineNames()

  for (const pipelineName of pipelineNames) {
    const plan = await readPipelineFile(pipelineName, 'plan.md')
    const evalDefinition = await readPipelineFile(pipelineName, 'eval.md')
    const workflow = await readPipelineFile(pipelineName, 'workflow.js')

    assert.match(plan, /Eval rubric/, `${pipelineName} Plan must define an Eval rubric`)
    assert.match(plan, /rubricReady/, `${pipelineName} Plan must return rubric readiness`)
    assert.match(plan, /passThreshold/, `${pipelineName} Plan must return its threshold`)

    assert.match(evalDefinition, /\.\.\/EVAL\.md/, `${pipelineName} Eval must use the shared guide`)
    assert.match(evalDefinition, /score:/, `${pipelineName} Eval must report a score`)
    assert.match(evalDefinition, /critical-failures:/, `${pipelineName} Eval must report critical failures`)
    assert.match(evalDefinition, /rubric-valid:/, `${pipelineName} Eval must report rubric validity`)

    assert.match(workflow, /rubricSha256/, `${pipelineName} workflow must fingerprint its rubric`)
    assert.match(workflow, /score:\s*\{ type: 'number' \}/, `${pipelineName} workflow must structure the score`)
    assert.match(workflow, /criticalFailures:\s*\{ type: 'number' \}/, `${pipelineName} workflow must structure critical failures`)
    assert.match(workflow, /rubricValid:\s*\{ type: 'boolean' \}/, `${pipelineName} workflow must structure rubric validity`)
    assert.match(workflow, /score\s*(?:>=|<)\s*.*[Pp]assThreshold/, `${pipelineName} workflow must enforce the score threshold`)
    assert.match(workflow, /\.criticalFailures\s*(?:===\s*0|>\s*0)/, `${pipelineName} workflow must reject critical failures`)
  }
})

test('bug-fix workflow passes a fully green scored Eval', async () => {
  const { events, result } = await runBugFixWorkflow()

  assert.equal(result.fixed, true)
  assert.deepEqual(events, ['explore', 'plan#1', 'execute#1', 'eval#1'])
})

test('bug-fix workflow fails below threshold and returns failed evidence to Plan', async () => {
  const lowScore = passingVerdict({ verdict: 'fail', score: 84, reason: 'score below threshold' })
  const { events, result } = await runBugFixWorkflow({
    plans: [passingPlan(), passingPlan()],
    verdicts: [lowScore, passingVerdict()],
  })

  assert.equal(result.fixed, true)
  assert.deepEqual(events, [
    'explore',
    'plan#1',
    'execute#1',
    'eval#1',
    'plan#2',
    'execute#2',
    'eval#2',
  ])
})

test('bug-fix workflow fails a high score when a critical criterion fails', async () => {
  const criticalFailure = passingVerdict({
    verdict: 'fail',
    score: 99,
    criticalFailures: 1,
    reason: 'critical regression failed',
  })
  const { events, result } = await runBugFixWorkflow({
    plans: [passingPlan(), passingPlan()],
    verdicts: [criticalFailure, passingVerdict()],
  })

  assert.equal(result.fixed, true)
  assert.equal(events[4], 'plan#2')
})

test('bug-fix workflow stops for human approval when Plan changes the locked rubric', async () => {
  const lowScore = passingVerdict({ verdict: 'fail', score: 84, reason: 'score below threshold' })
  const { events, result } = await runBugFixWorkflow({
    plans: [passingPlan(), passingPlan({ rubricSha256: 'b'.repeat(64) })],
    verdicts: [lowScore],
  })

  assert.equal(result.fixed, false)
  assert.equal(result.rubricChangeNeedsApproval, true)
  assert.deepEqual(events, ['explore', 'plan#1', 'execute#1', 'eval#1', 'plan#2'])
})

test('bug-fix workflow rejects new ESLint warnings even when the score is high', async () => {
  const newLintWarnings = passingVerdict({
    verdict: 'pass',
    score: 99,
    noNewEslintWarnings: false,
    reason: 'ESLint gained one warning',
  })
  const { events, result } = await runBugFixWorkflow({
    plans: [passingPlan(), passingPlan()],
    verdicts: [newLintWarnings, passingVerdict()],
  })

  assert.equal(result.fixed, true)
  assert.equal(events[4], 'plan#2')
})

test('bug-fix workflow stops for human approval when Eval observes a changed rubric fingerprint', async () => {
  const changedRubric = passingVerdict({ rubricSha256: 'c'.repeat(64) })
  const { events, result } = await runBugFixWorkflow({ verdicts: [changedRubric] })

  assert.equal(result.fixed, false)
  assert.equal(result.rubricChangeNeedsApproval, true)
  assert.deepEqual(events, ['explore', 'plan#1', 'execute#1', 'eval#1'])
})

test('feature workflow passes a complete valid Eval', async () => {
  const { events, result } = await runFeatureWorkflow()

  assert.equal(result.built, true)
  assert.deepEqual(events, ['explore', 'plan#1', 'execute#1', 'eval#1'])
})

test('feature workflow fails below threshold and returns failed evidence to Plan before another Execute', async () => {
  const lowScore = passingFeatureVerdict({
    score: 84,
    reason: 'score below threshold',
  })
  const { events, prompts, result } = await runFeatureWorkflow({
    plans: [passingPlan(), passingPlan()],
    verdicts: [lowScore, passingFeatureVerdict()],
  })

  assert.equal(result.built, true)
  assert.deepEqual(events, [
    'explore',
    'plan#1',
    'execute#1',
    'eval#1',
    'plan#2',
    'execute#2',
    'eval#2',
  ])

  const secondPlanPrompt = prompts.find((entry) => entry.label === 'plan#2')
  assert.ok(secondPlanPrompt)
  assert.match(
    secondPlanPrompt.prompt,
    /Previous attempt failed: score 84\/85, critical failures 0: score below threshold/,
  )
})

test('feature workflow fails a high score when a critical criterion fails', async () => {
  const criticalFailure = passingFeatureVerdict({
    score: 99,
    criticalFailures: 1,
    reason: 'critical regression failed',
  })
  const { events, result } = await runFeatureWorkflow({
    plans: [passingPlan(), passingPlan()],
    verdicts: [criticalFailure, passingFeatureVerdict()],
  })

  assert.equal(result.built, true)
  assert.equal(events[4], 'plan#2')
})

test('feature workflow rejects new ESLint warnings even when the score is high', async () => {
  const newLintWarnings = passingFeatureVerdict({
    score: 99,
    noNewEslintWarnings: false,
    reason: 'ESLint gained one warning',
  })
  const { events, result } = await runFeatureWorkflow({
    plans: [passingPlan(), passingPlan()],
    verdicts: [newLintWarnings, passingFeatureVerdict()],
  })

  assert.equal(result.built, true)
  assert.equal(events[4], 'plan#2')
})

test('feature workflow stops for human approval when Plan changes the locked rubric', async () => {
  const lowScore = passingFeatureVerdict({
    score: 84,
    reason: 'score below threshold',
  })
  const { events, result } = await runFeatureWorkflow({
    plans: [passingPlan(), passingPlan({ rubricSha256: 'b'.repeat(64) })],
    verdicts: [lowScore],
  })

  assert.equal(result.built, false)
  assert.equal(result.rubricChangeNeedsApproval, true)
  assert.deepEqual(events, ['explore', 'plan#1', 'execute#1', 'eval#1', 'plan#2'])
})

test('feature workflow stops for human approval when Eval observes a changed rubric fingerprint', async () => {
  const changedRubric = passingFeatureVerdict({
    rubricSha256: 'c'.repeat(64),
  })
  const { events, result } = await runFeatureWorkflow({
    verdicts: [changedRubric],
  })

  assert.equal(result.built, false)
  assert.equal(result.rubricChangeNeedsApproval, true)
  assert.deepEqual(events, ['explore', 'plan#1', 'execute#1', 'eval#1'])
})

test('feature workflow stops for human approval when Eval changes the locked threshold', async () => {
  const changedThreshold = passingFeatureVerdict({
    passThreshold: 86,
  })
  const { events, result } = await runFeatureWorkflow({
    verdicts: [changedThreshold],
  })

  assert.equal(result.built, false)
  assert.equal(result.rubricChangeNeedsApproval, true)
  assert.deepEqual(events, ['explore', 'plan#1', 'execute#1', 'eval#1'])
})
