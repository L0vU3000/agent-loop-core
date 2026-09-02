// Regression check for the review gate — the durable human UI/UX approval store. Pure
// filesystem-state tests (fixture root per test, like check-dispatch.regression.mjs), proving:
//   - a submission persists the full schema (run id, exact commit SHA, artifacts, routes,
//     viewports, a content-binding digest, status, timestamps);
//   - the digest binds the evidence — any change to commit/artifacts/routes/viewports changes it;
//   - approval accepts ONLY the exact pending submission's current commit + digest;
//   - a decided run (approved or rejected) can never be decided again without a fresh submission;
//   - a fresh submission (e.g. after a new commit) invalidates a stale pending citation and
//     reopens review.

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { computeDigest, decideReview, getReview, submitReview } from '../orchestrator/review-gate.mjs'

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'review-gate-check-'))
  try {
    return run(root)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

function basePacket(overrides = {}) {
  return {
    runId: '2026-08-22-100000',
    commitSha: COMMIT_A,
    artifacts: ['pipelines/feature/runs/2026-08-22-100000/screenshots/home.png'],
    routes: ['/'],
    viewports: ['375x812'],
    notes: 'first pass',
    ...overrides,
  }
}

test('submitReview persists a durable packet with the full schema', () => {
  withFixture((root) => {
    const record = submitReview(root, basePacket())

    assert.equal(record.runId, '2026-08-22-100000')
    assert.equal(record.commitSha, COMMIT_A)
    assert.deepEqual(record.artifacts, basePacket().artifacts)
    assert.deepEqual(record.routes, ['/'])
    assert.deepEqual(record.viewports, ['375x812'])
    assert.match(record.digest, /^[0-9a-f]{64}$/, 'digest must be a sha256 hex string')
    assert.equal(record.status, 'pending')
    assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.match(record.updatedAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(record.decidedAt, null)
    assert.equal(record.feedback, null)

    const onDisk = JSON.parse(readFileSync(join(root, 'orchestrator', 'review-gate', '2026-08-22-100000.json'), 'utf8'))
    assert.equal(onDisk.digest, record.digest)
    assert.ok(existsSync(join(root, 'orchestrator', 'review-gate', '2026-08-22-100000.json')))
  })
})

test('the digest binds packet contents — commit, artifacts, routes, or viewports changing changes it', () => {
  const base = computeDigest(basePacket())

  assert.notEqual(computeDigest(basePacket({ commitSha: COMMIT_B })), base)
  assert.notEqual(computeDigest(basePacket({ artifacts: ['other.png'] })), base)
  assert.notEqual(computeDigest(basePacket({ routes: ['/other'] })), base)
  assert.notEqual(computeDigest(basePacket({ viewports: ['1280x800'] })), base)
})

test('the digest is stable for identical evidence and insensitive to free-text notes', () => {
  withFixture((root) => {
    const first = submitReview(root, basePacket({ notes: 'a note' }))
    const second = submitReview(root, basePacket({ runId: 'other-run', notes: 'a totally different note' }))
    // Same evidence, different runId -> different digest (runId is bound); prove notes alone
    // does not perturb the digest by comparing two submissions that differ ONLY in notes.
    const third = submitReview(root, basePacket({ notes: 'yet another note' }))
    assert.equal(first.digest, third.digest, 'notes must not be part of the bound evidence')
    assert.notEqual(first.digest, second.digest, 'runId must be part of the bound evidence')
  })
})

test('approval accepts only the exact pending submission\'s current commit + digest', () => {
  withFixture((root) => {
    const submitted = submitReview(root, basePacket())

    assert.throws(
      () => decideReview(root, { runId: submitted.runId, commitSha: submitted.commitSha, digest: 'f'.repeat(64), decision: 'approved' }),
      /stale or mismatched evidence/,
    )
    assert.throws(
      () => decideReview(root, { runId: submitted.runId, commitSha: COMMIT_B, digest: submitted.digest, decision: 'approved' }),
      /stale or mismatched evidence/,
    )

    const approved = decideReview(root, { runId: submitted.runId, commitSha: submitted.commitSha, digest: submitted.digest, decision: 'approved' })
    assert.equal(approved.status, 'approved')
    assert.match(approved.decidedAt, /^\d{4}-\d{2}-\d{2}T/)
  })
})

test('a decided run can never be decided again without a fresh submission', () => {
  withFixture((root) => {
    const submitted = submitReview(root, basePacket())
    decideReview(root, { runId: submitted.runId, commitSha: submitted.commitSha, digest: submitted.digest, decision: 'approved' })

    assert.throws(
      () => decideReview(root, { runId: submitted.runId, commitSha: submitted.commitSha, digest: submitted.digest, decision: 'approved' }),
      /already decided/,
    )
    assert.throws(
      () => decideReview(root, { runId: submitted.runId, commitSha: submitted.commitSha, digest: submitted.digest, decision: 'rejected', feedback: 'too late' }),
      /already decided/,
    )
  })
})

test('rejection requires feedback and records it', () => {
  withFixture((root) => {
    const submitted = submitReview(root, basePacket())

    assert.throws(
      () => decideReview(root, { runId: submitted.runId, commitSha: submitted.commitSha, digest: submitted.digest, decision: 'rejected' }),
      /rejection requires feedback/,
    )

    const rejected = decideReview(root, {
      runId: submitted.runId, commitSha: submitted.commitSha, digest: submitted.digest,
      decision: 'rejected', feedback: 'spacing is broken on mobile',
    })
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.feedback, 'spacing is broken on mobile')
  })
})

test('stale invalidation: a newer submission invalidates a prior pending citation', () => {
  withFixture((root) => {
    const first = submitReview(root, basePacket({ commitSha: COMMIT_A }))
    const second = submitReview(root, basePacket({ commitSha: COMMIT_B, notes: 'fixed after review comments' }))

    assert.notEqual(first.digest, second.digest)

    // The old (commit A) evidence must be refused now that a fresh submission superseded it.
    assert.throws(
      () => decideReview(root, { runId: first.runId, commitSha: first.commitSha, digest: first.digest, decision: 'approved' }),
      /stale or mismatched evidence/,
    )

    // The current pending (commit B) evidence must still decide cleanly.
    const approved = decideReview(root, { runId: second.runId, commitSha: second.commitSha, digest: second.digest, decision: 'approved' })
    assert.equal(approved.status, 'approved')
    assert.equal(approved.commitSha, COMMIT_B)
  })
})

test('a fresh submission after a decision reopens review for a new commit', () => {
  withFixture((root) => {
    const submitted = submitReview(root, basePacket({ commitSha: COMMIT_A }))
    decideReview(root, {
      runId: submitted.runId, commitSha: submitted.commitSha, digest: submitted.digest,
      decision: 'rejected', feedback: 'fix contrast',
    })

    const resubmitted = submitReview(root, basePacket({ commitSha: COMMIT_B, notes: 'contrast fixed' }))
    assert.equal(resubmitted.status, 'pending')
    assert.equal(resubmitted.feedback, null)

    const approved = decideReview(root, { runId: resubmitted.runId, commitSha: resubmitted.commitSha, digest: resubmitted.digest, decision: 'approved' })
    assert.equal(approved.status, 'approved')
  })
})

test('validation rejects malformed submissions with specific, actionable errors', () => {
  withFixture((root) => {
    assert.throws(() => submitReview(root, basePacket({ commitSha: 'not-a-sha' })), /exact 40-character git commit SHA/)
    assert.throws(() => submitReview(root, basePacket({ commitSha: 'a'.repeat(39) })), /exact 40-character git commit SHA/)
    assert.throws(() => submitReview(root, basePacket({ artifacts: [] })), /artifacts must be a non-empty array/)
    assert.throws(() => submitReview(root, basePacket({ routes: [] })), /routes must be a non-empty array/)
    assert.throws(() => submitReview(root, basePacket({ viewports: [] })), /viewports must be a non-empty array/)
    assert.throws(() => submitReview(root, basePacket({ runId: '' })), /runId must be/)
  })
})

test('getReview returns null for an unknown run and the record otherwise', () => {
  withFixture((root) => {
    assert.equal(getReview(root, 'never-submitted'), null)
    const submitted = submitReview(root, basePacket())
    assert.deepEqual(getReview(root, submitted.runId), submitted)
  })
})
