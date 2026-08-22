// Regression check for the hard acceptance boundary between the durable UI review record
// (orchestrator/review-gate.mjs) and the record doorway (orchestrator/dispatch.mjs --record).
//
// Before this check: a claimed `pass` on a `uiReview: true` work item could move straight to
// done/ with no human decision at all — the workflow returning `awaitingHumanApproval` was
// advisory only, nothing at the record doorway actually looked at it. This proves the doorway
// now REFUSES a claimed pass on such an item unless:
//   - explicit review evidence (run id, commit SHA, digest) is supplied, AND
//   - the durable review-gate record for that run is `approved`, AND
//   - the supplied run id, commit SHA, and digest match that approved record EXACTLY, AND
//   - the consuming repository's current `git rev-parse HEAD` matches the approved commit SHA.
// `--skip-gate` (which bypasses the objective machinery+tsc gate) must NOT bypass this.
// A non-`uiReview` item is completely unaffected — same behavior as before this feature existed.

import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkUiReviewApproval, itemRequiresUiReview, recordClaimedOutcome } from '../orchestrator/dispatch.mjs'
import { decideReview, submitReview } from '../orchestrator/review-gate.mjs'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const SOURCE_ROOT = resolve(SCRIPT_DIRECTORY, '..')

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)

// Same fixture technique as check-dispatch.regression.mjs: copy just enough of the real
// agent-loop for the registry validator to pass.
function copyRegistryFixture(destinationRoot) {
  mkdirSync(join(destinationRoot, 'pipelines'), { recursive: true })
  mkdirSync(join(destinationRoot, 'orchestrator'), { recursive: true })
  cpSync(join(SOURCE_ROOT, 'categories.md'), join(destinationRoot, 'categories.md'))
  cpSync(join(SOURCE_ROOT, 'pipelines', 'README.md'), join(destinationRoot, 'pipelines', 'README.md'))
  cpSync(join(SOURCE_ROOT, 'orchestrator', 'orchestrator.md'), join(destinationRoot, 'orchestrator', 'orchestrator.md'))
  for (const entry of readdirSync(join(SOURCE_ROOT, 'pipelines'))) {
    const sourceDirectory = join(SOURCE_ROOT, 'pipelines', entry)
    if (!statSync(sourceDirectory).isDirectory()) continue
    const destinationDirectory = join(destinationRoot, 'pipelines', entry)
    mkdirSync(destinationDirectory, { recursive: true })
    cpSync(join(sourceDirectory, 'pipeline.md'), join(destinationDirectory, 'pipeline.md'))
  }
}

function writeItem(inboxDirectory, name, frontmatter) {
  const body = `---\n${Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\nwork item\n`
  writeFileSync(join(inboxDirectory, name), body)
}

function withFixture(run) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'ui-review-record-gate-check-'))
  try {
    copyRegistryFixture(fixtureRoot)
    const inbox = join(fixtureRoot, 'orchestrator', 'inbox')
    mkdirSync(inbox, { recursive: true })
    return run(fixtureRoot, inbox)
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
}

function approvedFixture(root, overrides = {}) {
  const submitted = submitReview(root, {
    runId: '2026-08-22-ui-1',
    commitSha: COMMIT_A,
    artifacts: ['pipelines/feature/runs/2026-08-22-ui-1/screenshots/home.png'],
    routes: ['/'],
    viewports: ['375x812'],
    ...overrides,
  })
  return decideReview(root, { runId: submitted.runId, commitSha: submitted.commitSha, digest: submitted.digest, decision: 'approved' })
}

test('itemRequiresUiReview reads the uiReview: true frontmatter, claimed-or-top-level', () => {
  withFixture((root, inbox) => {
    writeItem(inbox, '10-ui.md', { category: 'building', type: 'feature', priority: 'normal', created: '2026-08-22', uiReview: 'true' })
    writeItem(inbox, '20-plain.md', { category: 'building', type: 'feature', priority: 'normal', created: '2026-08-22' })
    assert.equal(itemRequiresUiReview(root, '10-ui.md'), true)
    assert.equal(itemRequiresUiReview(root, '20-plain.md'), false)
    assert.equal(itemRequiresUiReview(root, 'missing.md'), false)
  })
})

test('checkUiReviewApproval refuses missing evidence, pending, rejected, mismatched, and stale-HEAD citations; accepts the exact approved one', () => {
  withFixture((root) => {
    // No evidence supplied at all.
    assert.equal(checkUiReviewApproval(root, { runId: '', commitSha: '', digest: '', currentHead: '' }).ok, false)
    assert.match(checkUiReviewApproval(root, { runId: '', commitSha: '', digest: '', currentHead: '' }).reason, /evidence missing/)

    // Never submitted.
    const never = checkUiReviewApproval(root, { runId: 'nope', commitSha: COMMIT_A, digest: 'f'.repeat(64), currentHead: COMMIT_A })
    assert.equal(never.ok, false)
    assert.match(never.reason, /no review submission found/)

    // Pending (submitted, not yet decided).
    const pendingSubmission = submitReview(root, {
      runId: 'pending-run', commitSha: COMMIT_A,
      artifacts: ['a.png'], routes: ['/'], viewports: ['375x812'],
    })
    const pendingCheck = checkUiReviewApproval(root, {
      runId: pendingSubmission.runId, commitSha: pendingSubmission.commitSha, digest: pendingSubmission.digest, currentHead: COMMIT_A,
    })
    assert.equal(pendingCheck.ok, false)
    assert.match(pendingCheck.reason, /not approved/)

    // Rejected.
    const rejectedSubmission = submitReview(root, {
      runId: 'rejected-run', commitSha: COMMIT_A,
      artifacts: ['a.png'], routes: ['/'], viewports: ['375x812'],
    })
    decideReview(root, {
      runId: rejectedSubmission.runId, commitSha: rejectedSubmission.commitSha, digest: rejectedSubmission.digest,
      decision: 'rejected', feedback: 'contrast is broken',
    })
    const rejectedCheck = checkUiReviewApproval(root, {
      runId: rejectedSubmission.runId, commitSha: rejectedSubmission.commitSha, digest: rejectedSubmission.digest, currentHead: COMMIT_A,
    })
    assert.equal(rejectedCheck.ok, false)
    assert.match(rejectedCheck.reason, /not approved/)

    // Approved — now probe mismatches against it.
    const approved = approvedFixture(root)

    const mismatchedDigest = checkUiReviewApproval(root, {
      runId: approved.runId, commitSha: approved.commitSha, digest: 'f'.repeat(64), currentHead: approved.commitSha,
    })
    assert.equal(mismatchedDigest.ok, false)
    assert.match(mismatchedDigest.reason, /does not match the approved record/)

    const mismatchedCommit = checkUiReviewApproval(root, {
      runId: approved.runId, commitSha: COMMIT_B, digest: approved.digest, currentHead: approved.commitSha,
    })
    assert.equal(mismatchedCommit.ok, false)
    assert.match(mismatchedCommit.reason, /does not match the approved record/)

    const staleHead = checkUiReviewApproval(root, {
      runId: approved.runId, commitSha: approved.commitSha, digest: approved.digest, currentHead: COMMIT_B,
    })
    assert.equal(staleHead.ok, false)
    assert.match(staleHead.reason, /does not match the approved commit/)

    // Exact approved evidence + matching current HEAD: accepted.
    const exact = checkUiReviewApproval(root, {
      runId: approved.runId, commitSha: approved.commitSha, digest: approved.digest, currentHead: approved.commitSha,
    })
    assert.equal(exact.ok, true)
  })
})

test('the record doorway refuses a claimed pass on a uiReview item without approval evidence, even with --skip-gate', () => {
  withFixture((root, inbox) => {
    writeItem(inbox, '10-ui.md', { category: 'building', type: 'feature', priority: 'normal', created: '2026-08-22', uiReview: 'true' })

    assert.throws(
      () => recordClaimedOutcome(root, '10-ui.md', 'pass', {}),
      /UI review gate refused/,
      'a claimed pass with zero review evidence must be refused',
    )
    assert.throws(
      () => recordClaimedOutcome(root, '10-ui.md', 'pass', { skipGate: true }),
      /UI review gate refused/,
      '--skip-gate must not bypass the UI review requirement',
    )
    assert.ok(existsSync(join(inbox, '10-ui.md')), 'a refused record must leave the item exactly where it was')
  })
})

test('the record doorway refuses a claimed pass citing a pending or rejected review', () => {
  withFixture((root, inbox) => {
    writeItem(inbox, '10-ui.md', { category: 'building', type: 'feature', priority: 'normal', created: '2026-08-22', uiReview: 'true' })

    const pending = submitReview(root, {
      runId: 'pending-run', commitSha: COMMIT_A, artifacts: ['a.png'], routes: ['/'], viewports: ['375x812'],
    })
    assert.throws(
      () => recordClaimedOutcome(root, '10-ui.md', 'pass', {
        skipGate: true, reviewRunId: pending.runId, reviewCommitSha: pending.commitSha, reviewDigest: pending.digest, currentHead: COMMIT_A,
      }),
      /not approved/,
    )

    const toReject = submitReview(root, {
      runId: 'rejected-run', commitSha: COMMIT_A, artifacts: ['a.png'], routes: ['/'], viewports: ['375x812'],
    })
    decideReview(root, { runId: toReject.runId, commitSha: toReject.commitSha, digest: toReject.digest, decision: 'rejected', feedback: 'nope' })
    assert.throws(
      () => recordClaimedOutcome(root, '10-ui.md', 'pass', {
        skipGate: true, reviewRunId: toReject.runId, reviewCommitSha: toReject.commitSha, reviewDigest: toReject.digest, currentHead: COMMIT_A,
      }),
      /not approved/,
    )
    assert.ok(existsSync(join(inbox, '10-ui.md')), 'still refused — item must not move')
  })
})

test('the record doorway refuses a claimed pass with a mismatched digest or a changed HEAD, and accepts exact approved evidence', () => {
  withFixture((root, inbox) => {
    writeItem(inbox, '10-ui.md', { category: 'building', type: 'feature', priority: 'normal', created: '2026-08-22', uiReview: 'true' })
    const approved = approvedFixture(root)

    assert.throws(
      () => recordClaimedOutcome(root, '10-ui.md', 'pass', {
        skipGate: true, reviewRunId: approved.runId, reviewCommitSha: approved.commitSha, reviewDigest: 'f'.repeat(64), currentHead: approved.commitSha,
      }),
      /does not match the approved record/,
      'mismatched digest must be refused',
    )
    assert.throws(
      () => recordClaimedOutcome(root, '10-ui.md', 'pass', {
        skipGate: true, reviewRunId: approved.runId, reviewCommitSha: approved.commitSha, reviewDigest: approved.digest, currentHead: COMMIT_B,
      }),
      /does not match the approved commit/,
      'a consuming-repo HEAD that has moved past the approved commit must be refused',
    )
    assert.ok(existsSync(join(inbox, '10-ui.md')), 'still refused — item must not move to done/')

    // Exact approved evidence + HEAD == approved commit: the doorway proceeds and records pass.
    const recorded = recordClaimedOutcome(root, '10-ui.md', 'pass', {
      skipGate: true, reviewRunId: approved.runId, reviewCommitSha: approved.commitSha, reviewDigest: approved.digest, currentHead: approved.commitSha,
    })
    assert.equal(recorded.decision.outcome, 'pass')
    assert.equal(recorded.moved, 'inbox/done/10-ui.md')
    assert.ok(existsSync(join(inbox, 'done', '10-ui.md')), 'an exactly-approved review must be allowed to reach done/')
  })
})

test('a non-uiReview item is completely unaffected by the UI review gate', () => {
  withFixture((root, inbox) => {
    writeItem(inbox, '10-lint.md', { category: 'maintenance', type: 'lint', priority: 'normal', created: '2026-08-22' })

    // No review evidence supplied at all, and it still records pass exactly as before this
    // feature existed (skipGate:true only to dodge the real objective gate in this fixture,
    // not related to the UI review requirement being tested here).
    const recorded = recordClaimedOutcome(root, '10-lint.md', 'pass', { skipGate: true })
    assert.equal(recorded.decision.outcome, 'pass')
    assert.equal(recorded.moved, 'inbox/done/10-lint.md')
  })
})

test('a claimed fail never triggers the UI review requirement', () => {
  withFixture((root, inbox) => {
    writeItem(inbox, '10-ui.md', { category: 'building', type: 'feature', priority: 'normal', created: '2026-08-22', uiReview: 'true' })
    const recorded = recordClaimedOutcome(root, '10-ui.md', 'fail', {})
    assert.equal(recorded.decision.outcome, 'fail')
    assert.equal(recorded.moved, 'inbox/failed/10-ui.md')
  })
})
