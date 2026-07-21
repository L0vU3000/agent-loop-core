// Red-to-green regression guard for the e2e-regression pipeline's clean-path routing.
//
// The bug this locks out: workflow.js used to gate the verification-only "clean" path on
// `triage.suiteGreen` alone. A run that targets an open de-flake ticket whose named test is still
// `test.skip`-quarantined reports the suite green only because the target was never exercised —
// so the workflow reported `clean: true` without ever entering the Fix loop that would lift the
// quarantine. The fix requires explore to affirmatively report `ticketedQuarantinesUnskipped`, and
// the clean-path guard to require it alongside `suiteGreen`.
//
// Technique mirrors check-eval-scoring.regression.mjs: read the real workflow source, strip the
// `export`, wrap it in an AsyncFunction, and drive it with a controlled agent() mock so the routing
// decision is exercised deterministically with no external dependencies. The `.regression.mjs`
// suffix keeps this file out of the Vitest collector (memory/errors.md, 2026-07-16).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const WORKFLOW = new URL('../pipelines/e2e-regression/workflow.js', import.meta.url)
const EXPLORE = new URL('../pipelines/e2e-regression/explore.md', import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

const LOCKED_RUBRIC_SHA256 = 'a'.repeat(64)

function passingPlan(overrides = {}) {
  return {
    rubricReady: true,
    passThreshold: 90,
    rubricSha256: LOCKED_RUBRIC_SHA256,
    ...overrides,
  }
}

function passingVerdict(overrides = {}) {
  return {
    verdict: 'pass',
    score: 100,
    passThreshold: 90,
    criticalFailures: 0,
    rubricValid: true,
    regressionsFixed: true,
    twoGreenRuns: true,
    dispositionsComplete: true,
    tscErrors: 0,
    evidence: 'deterministic e2e-regression workflow harness',
    reason: 'all checks passed',
    ...overrides,
  }
}

function triageResult(overrides = {}) {
  return {
    runId: 'e2e-regression-harness',
    suiteGreen: true,
    regressionCount: 0,
    flakeCount: 0,
    ticketedQuarantinesUnskipped: true,
    ...overrides,
  }
}

async function runWorkflow({
  triage = triageResult(),
  cleanPlan = passingPlan(),
  cleanVerdict = passingVerdict(),
  plans = [passingPlan()],
  verdicts = [passingVerdict()],
} = {}) {
  const source = await readFile(WORKFLOW, 'utf8')
  const executableSource = source.replace('export const meta', 'const meta')
  const events = []
  const logs = []
  let planIndex = 0
  let verdictIndex = 0

  async function agent(_prompt, options) {
    events.push(options.label)

    if (options.label === 'explore') {
      return triage
    }
    if (options.label === 'plan-clean') {
      return cleanPlan
    }
    if (options.label === 'eval-clean') {
      return cleanVerdict
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

test('green suite with an un-lifted ticketed quarantine refuses the clean path and enters the Fix loop', async () => {
  const { events, result } = await runWorkflow({
    triage: triageResult({ ticketedQuarantinesUnskipped: false }),
  })

  assert.notEqual(result.clean, true, 'must NOT report clean:true when a ticketed quarantine is still skipped')
  assert.ok(!events.includes('plan-clean'), 'must NOT enter the verification-only plan-clean stage')
  assert.ok(!events.includes('eval-clean'), 'must NOT enter the verification-only eval-clean stage')
  assert.ok(events.includes('plan#1'), 'must enter the Fix loop (plan#1)')
})

test('genuinely clean run (green suite, quarantines lifted) still reaches clean:true via the fast path', async () => {
  const { events, result } = await runWorkflow({
    triage: triageResult({ ticketedQuarantinesUnskipped: true }),
  })

  assert.equal(result.clean, true, 'the ordinary clean case must still pass via the fast path')
  assert.deepEqual(events, ['explore', 'plan-clean', 'eval-clean'])
  assert.ok(!events.includes('plan#1'), 'the genuinely clean case must NOT enter the Fix loop')
})

test('a real regression run (suiteGreen:false) is unaffected by the new field and completes the Fix loop', async () => {
  const { events, result } = await runWorkflow({
    triage: triageResult({ suiteGreen: false, regressionCount: 1, ticketedQuarantinesUnskipped: false }),
  })

  assert.equal(result.done, true, 'a real regression run must still complete the Fix loop')
  assert.deepEqual(events, ['explore', 'plan#1', 'execute#1', 'eval#1'])
  assert.ok(!events.includes('plan-clean'), 'a regression run must never take the clean path')
})

test('TRIAGE schema requires ticketedQuarantinesUnskipped (cannot be silently dropped)', async () => {
  const source = await readFile(WORKFLOW, 'utf8')
  const requiredMatch = source.match(/const TRIAGE = \{[^}]*required:\s*\[([^\]]*)\]/)

  assert.ok(requiredMatch, 'TRIAGE must declare a required array')
  assert.match(requiredMatch[1], /'ticketedQuarantinesUnskipped'/, 'ticketedQuarantinesUnskipped must be required')
  assert.match(source, /ticketedQuarantinesUnskipped:\s*\{ type: 'boolean' \}/, 'ticketedQuarantinesUnskipped must be a typed property')
})

test('explore.md instructs computing the new field from open inbox tickets against skip state', async () => {
  const explore = await readFile(EXPLORE, 'utf8')

  assert.match(explore, /ticketedQuarantinesUnskipped/, 'explore.md must name the field it computes')
  assert.match(explore, /orchestrator\/inbox/, 'explore.md must instruct checking open inbox tickets')
})
