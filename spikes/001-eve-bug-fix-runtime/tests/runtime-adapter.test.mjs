import assert from 'node:assert/strict'
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  applyVerification,
  createRunState,
  decideRecordOutcome,
  lockRubric,
  recordMakerArtifact,
} from '../agent/lib/runtime-adapter.mjs'
import { claimNextBugFix, recordClaimedBugFix } from '../control-plane/dispatcher-adapter.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const AGENT_LOOP_ROOT = resolve(HERE, '../../..')

function copyRegistryFixture(destinationRoot) {
  mkdirSync(join(destinationRoot, 'pipelines'), { recursive: true })
  mkdirSync(join(destinationRoot, 'orchestrator', 'inbox'), { recursive: true })
  cpSync(join(AGENT_LOOP_ROOT, 'categories.md'), join(destinationRoot, 'categories.md'))
  cpSync(join(AGENT_LOOP_ROOT, 'pipelines', 'README.md'), join(destinationRoot, 'pipelines', 'README.md'))
  cpSync(join(AGENT_LOOP_ROOT, 'orchestrator', 'orchestrator.md'), join(destinationRoot, 'orchestrator', 'orchestrator.md'))

  for (const entry of readdirSync(join(AGENT_LOOP_ROOT, 'pipelines'))) {
    const sourceDirectory = join(AGENT_LOOP_ROOT, 'pipelines', entry)
    if (!statSync(sourceDirectory).isDirectory()) continue
    const destinationDirectory = join(destinationRoot, 'pipelines', entry)
    mkdirSync(destinationDirectory, { recursive: true })
    cpSync(join(sourceDirectory, 'pipeline.md'), join(destinationDirectory, 'pipeline.md'))
    const workflow = join(sourceDirectory, 'workflow.js')
    try {
      cpSync(workflow, join(destinationDirectory, 'workflow.js'))
    } catch {
      // A documented-only pipeline is still a valid registry entry.
    }
  }
}

function writeBugItem(root, filename = '10-fixture-bug.md') {
  writeFileSync(join(root, 'orchestrator', 'inbox', filename), `---\ncategory: building\ntype: bug\npriority: high\n---\n\nFix the fixture defect.\n`)
}

test('claims the highest-priority bug-fix item through the canonical dispatcher', () => {
  const root = mkdtempSync(join(tmpdir(), 'eve-adapter-dispatch-'))
  try {
    copyRegistryFixture(root)
    writeBugItem(root)

    const claimed = claimNextBugFix(root)

    assert.deepEqual(claimed, {
      file: '10-fixture-bug.md',
      pipeline: 'bug-fix',
      workflow: 'pipelines/bug-fix/workflow.js',
      claimPath: 'inbox/in-progress/10-fixture-bug.md',
    })

    assert.deepEqual(recordClaimedBugFix(root, claimed.file, {
      verification: { verdict: 'pass' },
      objectiveGate: { checked: true, passed: true },
    }), {
      outcome: 'pass',
      moved: 'inbox/done/10-fixture-bug.md',
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('locks one run id and rubric across every later phase', () => {
  const initial = createRunState({
    runId: 'run-fixture-001',
    file: '10-fixture-bug.md',
    maxIterations: 2,
  })
  const rubric = {
    sha256: 'a'.repeat(64),
    passThreshold: 0.9,
  }

  const locked = lockRubric(initial, rubric)
  const relocked = lockRubric(locked, rubric)

  assert.equal(initial.rubric, null, 'state transitions must not mutate earlier checkpoints')
  assert.equal(locked.runId, 'run-fixture-001')
  assert.equal(locked.phase, 'execute')
  assert.equal(locked.iteration, 1)
  assert.deepEqual(relocked, locked, 'idempotent step replay must preserve the lock')
  assert.throws(
    () => lockRubric(locked, { ...rubric, sha256: 'b'.repeat(64) }),
    /RUBRIC_CHANGE_REQUIRES_APPROVAL/,
  )
})

test('retries verifier failures only within the configured iteration bound', () => {
  const rubric = { sha256: 'a'.repeat(64), passThreshold: 0.9 }
  const firstAttempt = recordMakerArtifact(lockRubric(createRunState({
    runId: 'run-fixture-002',
    file: '20-bounded-loop.md',
    maxIterations: 2,
  }), rubric), { branch: 'fixture/attempt-1', commit: 'abc1234' })

  const retry = applyVerification(firstAttempt, {
    verifier: 'independent-verifier',
    verdict: 'fail',
    score: 0.4,
    commit: 'abc1234',
  })
  const secondAttempt = recordMakerArtifact(retry, {
    branch: 'fixture/attempt-2',
    commit: 'def5678',
  })
  const exhausted = applyVerification(secondAttempt, {
    verifier: 'independent-verifier',
    verdict: 'fail',
    score: 0.7,
    commit: 'def5678',
  })

  assert.equal(retry.phase, 'execute')
  assert.equal(retry.iteration, 2)
  assert.equal(retry.runId, firstAttempt.runId)
  assert.equal(exhausted.phase, 'failed')
  assert.equal(exhausted.iteration, 2)
  assert.match(exhausted.failureReason, /iteration limit/)
})

test('accepts verifier evidence only for the exact maker commit', () => {
  const planned = lockRubric(createRunState({
    runId: 'run-fixture-003',
    file: '30-artifact-boundary.md',
  }), { sha256: 'a'.repeat(64), passThreshold: 0.9 })
  const made = recordMakerArtifact(planned, {
    branch: 'fixture/eve-run',
    commit: 'abc1234',
  })

  assert.throws(() => applyVerification(made, {
    verifier: 'independent-verifier',
    verdict: 'pass',
    score: 1,
    commit: 'different-commit',
  }), /VERIFIER_COMMIT_MISMATCH/)

  const passed = applyVerification(made, {
    verifier: 'independent-verifier',
    verdict: 'pass',
    score: 1,
    commit: 'abc1234',
  })
  assert.equal(passed.phase, 'objective-gate')
  assert.throws(() => applyVerification(passed, {
    verifier: 'independent-verifier',
    verdict: 'pass',
    score: 1,
    commit: 'abc1234',
  }), /VERIFICATION_NOT_EXPECTED_IN_CURRENT_PHASE/)
})

test('never records pass without both verifier pass and objective gate pass', () => {
  assert.equal(decideRecordOutcome({
    verification: { verdict: 'pass' },
    objectiveGate: { checked: true, passed: true },
  }), 'pass')

  assert.equal(decideRecordOutcome({
    verification: { verdict: 'pass' },
    objectiveGate: { checked: true, passed: false },
  }), 'fail')

  assert.equal(decideRecordOutcome({
    verification: { verdict: 'fail' },
    objectiveGate: { checked: true, passed: true },
  }), 'fail')

  assert.equal(decideRecordOutcome({
    verification: { verdict: 'pass' },
    objectiveGate: { checked: false, passed: false },
  }), 'fail')
})
