// Regression guard for the feature pipeline's opt-in human UI/UX approval gate.
//
// Technique mirrors check-eval-scoring.regression.mjs: read the real workflow.js source, strip
// the `export`, wrap it in an AsyncFunction, and drive it with a scripted agent() so the gate's
// position and result shape are exercised deterministically with no external dependencies.
//
// What this locks in:
//   - a ticket that does not opt in (`uiReview` unset) is unaffected — no review stage, same
//     result shape as before this feature existed;
//   - an opted-in ticket only enters the review stage AFTER Eval has passed;
//   - a passing review submission returns awaiting-human-approval, never the unconditional DONE;
//   - the review-stage prompt instructs capturing screenshots, the exact commit SHA, submitting
//     to review-gate.mjs, and sending the captured screenshot FILES as media/image attachments
//     to the configured Telegram chat (alongside the commit + digest) — not just a pointer to
//     where they live — WITHOUT claiming delivery succeeded when media messaging is unavailable;
//   - a review stage that could not even submit the packet stops without claiming success.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const FEATURE_WORKFLOW = new URL('../pipelines/feature/workflow.js', import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const LOCKED_RUBRIC_SHA256 = 'a'.repeat(64)

function passingPlan(overrides = {}) {
  return { rubricReady: true, passThreshold: 85, rubricSha256: LOCKED_RUBRIC_SHA256, ...overrides }
}

function passingVerdict(overrides = {}) {
  return {
    verdict: 'pass', score: 100, passThreshold: 85, criticalFailures: 0, rubricValid: true,
    rubricSha256: LOCKED_RUBRIC_SHA256, acceptancePasses: true, suiteGreen: true, tscErrors: 0,
    noNewEslintWarnings: true, evidence: 'ui-review-gate regression harness', reason: 'all checks passed',
    ...overrides,
  }
}

async function runFeatureWorkflow({
  uiReview,
  review = {
    submitted: true, commitSha: 'f'.repeat(40), digest: 'd'.repeat(64),
    notified: true, routes: ['/'], viewports: ['375x812'],
  },
  plans = [passingPlan()],
  verdicts = [passingVerdict()],
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
      const spec = {
        specified: true, runId: 'ui-review-gate-regression', testPath: 'x.test.ts',
        criteria: 'the feature workflow must gate on ui review when opted in',
      }
      if (uiReview !== undefined) spec.uiReview = uiReview
      return spec
    }
    if (options.label.startsWith('plan#')) {
      const plan = plans[Math.min(planIndex, plans.length - 1)]
      planIndex += 1
      return plan
    }
    if (options.label.startsWith('split#')) return { tasks: [], reason: 'solo path — ui review gate regression' }
    if (options.label.startsWith('execute#')) return {}
    if (options.label.startsWith('eval#')) {
      const verdict = verdicts[Math.min(verdictIndex, verdicts.length - 1)]
      verdictIndex += 1
      return verdict
    }
    if (options.label.startsWith('ui-review#')) return review

    throw new Error(`Unexpected agent label: ${options.label}`)
  }

  const executeWorkflow = new AsyncFunction('args', 'phase', 'agent', 'log', 'pipeline', executableSource)
  const result = await executeWorkflow('', () => {}, agent, (message) => logs.push(message), async () => [])

  return { events, logs, prompts, result }
}

test('a ticket that does not opt in is unaffected: no review stage, plain DONE result', async () => {
  const { events, result, logs } = await runFeatureWorkflow({ uiReview: undefined })

  assert.deepEqual(events, ['explore', 'plan#1', 'split#1', 'execute#1', 'eval#1'])
  assert.equal(result.built, true)
  assert.equal(result.awaitingHumanApproval, undefined)
  assert.ok(logs.some((line) => /^DONE:/.test(line)))
})

test('an opted-in ticket only enters the review gate AFTER Eval passes, and stops short of final success', async () => {
  const { events, result, logs, prompts } = await runFeatureWorkflow({ uiReview: true })

  assert.deepEqual(events, ['explore', 'plan#1', 'split#1', 'execute#1', 'eval#1', 'ui-review#1'])
  assert.equal(
    events.indexOf('ui-review#1'), events.indexOf('eval#1') + 1,
    'the review gate must run immediately after Eval, not before',
  )
  assert.equal(result.built, true)
  assert.equal(result.awaitingHumanApproval, true, 'a UI-gated pass must not report final success')
  assert.equal(result.commitSha, 'f'.repeat(40))
  assert.equal(result.digest, 'd'.repeat(64))
  assert.ok(!logs.some((line) => /^DONE:/.test(line)), 'must not claim the unconditional DONE outcome once a human gate is pending')
  assert.ok(logs.some((line) => /AWAITING HUMAN APPROVAL/.test(line)))

  const reviewPrompt = prompts.find((entry) => entry.label === 'ui-review#1')
  assert.ok(reviewPrompt, 'the review stage must actually be invoked')
  assert.match(reviewPrompt.prompt, /screenshot/i)
  assert.match(reviewPrompt.prompt, /git rev-parse HEAD/)
  assert.match(reviewPrompt.prompt, /review-gate\.mjs --submit/)
  assert.match(reviewPrompt.prompt, /Telegram/)
  // Gap: the prompt must explicitly instruct sending the screenshot FILES as media/image
  // attachments — a pointer to where artifacts live is not the same as delivering the images.
  assert.match(
    reviewPrompt.prompt,
    /send (the )?(captured )?screenshot files? as .{0,20}attachments?/i,
    'the prompt must instruct sending screenshots as attachments, not just a pointer',
  )
  assert.match(reviewPrompt.prompt, /media.{0,10}image|image.{0,10}media/i, 'the attachments must be media/image, not generic files')
  assert.match(
    reviewPrompt.prompt,
    /attachments?.{0,80}(commit|digest).{0,40}(commit|digest)/is,
    'the attachment instruction must be alongside the commit and digest',
  )
  assert.match(reviewPrompt.prompt, /do NOT claim (the )?screenshots? (were|was) (delivered|sent)/i)
  assert.match(reviewPrompt.prompt, /notified\s*=\s*false/)
  assert.match(reviewPrompt.prompt, /media messaging.{0,20}unavailable/i)
})

test('a review stage that could not submit the packet stops without claiming success', async () => {
  const { events, result, logs } = await runFeatureWorkflow({
    uiReview: true,
    review: { submitted: false, commitSha: '', digest: '', notified: false, reason: 'no screenshot tooling available' },
  })

  assert.deepEqual(events, ['explore', 'plan#1', 'split#1', 'execute#1', 'eval#1', 'ui-review#1'])
  assert.equal(result.awaitingHumanApproval, undefined)
  assert.equal(result.uiReviewRequired, true)
  assert.equal(result.uiReviewSubmitted, false)
  assert.ok(!logs.some((line) => /^DONE:/.test(line)))
  assert.ok(logs.some((line) => /STOP: UI review packet could not be submitted/.test(line)))
})
