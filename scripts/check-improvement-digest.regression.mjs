// Regression check for the improvement-digest builder. Drives the pure functions against
// fixtures — no filesystem, no live runs. Proves the backlog ranks real weaknesses above cheap
// signals, ignores normal approval-gated pauses, and never invents a candidate from a clean run.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseEvalScorecard, evalCandidate, runCandidates, buildDigest } from '../orchestrator/improvement-digest.mjs'

test('parseEvalScorecard reads the current scorecard block', () => {
  const parsed = parseEvalScorecard(
    'verdict: fail\nscore: 72/100\nthreshold: 85/100\ncritical-failures: 1\nrubric-valid: yes\n',
  )
  assert.equal(parsed.verdict, 'fail')
  assert.equal(parsed.score, 72)
  assert.equal(parsed.threshold, 85)
  assert.equal(parsed.criticalFailures, 1)
})

test('parseEvalScorecard tolerates the old verdict-only format', () => {
  const parsed = parseEvalScorecard('# Eval verdict\nverdict: pass\neslint: 63 -> 55\n')
  assert.equal(parsed.verdict, 'pass')
  assert.equal(parsed.score, null)
  assert.equal(parsed.threshold, null)
  assert.equal(parsed.criticalFailures, null)
})

test('a clean pass produces no candidate', () => {
  const candidate = evalCandidate({ pipeline: 'qa', run: 'r1', verdict: 'pass', score: 100, threshold: 85, criticalFailures: 0 })
  assert.equal(candidate, null)
})

test('a below-threshold score and a critical failure both surface, critical outranks', () => {
  const belowThreshold = evalCandidate({ pipeline: 'feature', run: 'r2', verdict: 'fail', score: 80, threshold: 85, criticalFailures: 0 })
  assert.equal(belowThreshold.severity, 90) // verdict fail dominates
  assert.match(belowThreshold.what, /below threshold/)

  const critical = evalCandidate({ pipeline: 'bug-fix', run: 'r3', verdict: 'fail', score: 92, threshold: 85, criticalFailures: 2 })
  assert.equal(critical.severity, 90)
  assert.match(critical.what, /2 critical failure/)
})

test('runCandidates flags failures but not approval-gated pauses', () => {
  const runs = [
    { pipeline: 'entity-scaffold', runId: 'wf_pause', status: 'completed', agentCount: 2, stages: [{}, {}], durationMs: 700000, totalTokens: 190000, iterations: 0, result: { built: false, awaitingPlanApproval: true } },
    { pipeline: 'entity-scaffold', runId: 'wf_fail', status: 'failed', agentCount: 0, stages: [], durationMs: 8, totalTokens: 0, iterations: 0 },
  ]
  const candidates = runCandidates(runs)
  assert.equal(candidates.length, 1, 'the paused run must not be flagged, only the failed one')
  assert.equal(candidates[0].where, 'entity-scaffold · wf_fail')
  assert.equal(candidates[0].severity, 100)
})

test('runCandidates distinguishes a 0-stage machinery startup crash from a modeling failure', () => {
  // Both rows are real ledger instances of the same shape (0 agents, 0 stages, sub-second, 0
  // tokens, status "failed") but from different pipelines on different days — the fix must key on
  // that SHAPE, not on either literal runId or pipeline name.
  const crashes = [
    { pipeline: 'entity-scaffold', runId: 'wf_62308c33-024', status: 'failed', agentCount: 0, stages: [], durationMs: 8, totalTokens: 0, iterations: 0 },
    { pipeline: 'pipeline-improve', runId: 'wf_550ba196-c2f', status: 'failed', agentCount: 0, stages: [], durationMs: 10, totalTokens: 0, iterations: 0 },
  ]
  for (const crash of crashes) {
    const candidate = runCandidates([crash])[0]
    assert.ok(candidate, `${crash.runId} must surface as a candidate`)
    assert.equal(candidate.severity, 100, `${crash.runId} must rank at the hard-failure floor, not below`)
    assert.match(
      candidate.what,
      /startup crash|before any agent ran|0 stages/i,
      `${crash.runId} must read as a distinguishable startup crash, not the generic modeling failure`,
    )
  }

  // A genuine hard failure that ran stages and burned tokens must still read the generic message —
  // proving the fix keys on the crash shape, not on relabeling every failed run.
  const hardFailure = runCandidates([
    { pipeline: 'feature', runId: 'wf_real_fail', status: 'failed', agentCount: 2, stages: [{}, {}], durationMs: 640000, totalTokens: 190000, iterations: 0 },
  ])[0]
  assert.equal(hardFailure.severity, 100)
  assert.equal(hardFailure.what, 'run failed (status: failed)')
})

test('runCandidates flags a cost outlier once a pipeline has enough runs', () => {
  const runs = [
    { pipeline: 'lint', runId: 'a', status: 'completed', agentCount: 3, stages: [{}], durationMs: 5000, totalTokens: 100, iterations: 1 },
    { pipeline: 'lint', runId: 'b', status: 'completed', agentCount: 3, stages: [{}], durationMs: 5000, totalTokens: 100, iterations: 1 },
    { pipeline: 'lint', runId: 'c', status: 'completed', agentCount: 3, stages: [{}], durationMs: 5000, totalTokens: 100, iterations: 1 },
    { pipeline: 'lint', runId: 'spendy', status: 'completed', agentCount: 3, stages: [{}], durationMs: 5000, totalTokens: 1000, iterations: 1 },
  ]
  const spendy = runCandidates(runs).find((c) => c.where.endsWith('spendy'))
  assert.ok(spendy, 'the 10x-cost run should be a candidate')
  assert.match(spendy.what, /cost outlier/)
})

test('buildDigest ranks by severity and renders the empty state', () => {
  const now = '2026-07-17 09:00'
  const empty = buildDigest({ runs: [], evals: [], errors: { count: 0, latest: null }, now })
  assert.match(empty, /No candidates/)

  const digest = buildDigest({
    runs: [{ pipeline: 'feature', runId: 'wf_x', status: 'completed', agentCount: 4, stages: [{}], durationMs: 5000, totalTokens: 100, iterations: 2 }],
    evals: [{ pipeline: 'bug-fix', run: 'r9', verdict: 'fail', score: 40, threshold: 85, criticalFailures: 1 }],
    errors: { count: 5, latest: '[2026-07-16] something broke' },
    now,
  })
  const failIndex = digest.indexOf('bug-fix · run r9')
  const lapIndex = digest.indexOf('feature · wf_x')
  assert.ok(failIndex !== -1 && lapIndex !== -1, 'both candidates present')
  assert.ok(failIndex < lapIndex, 'the critical eval failure ranks above the slow-convergence note')
  assert.match(digest, /holds \*\*5\*\* entries/)
})
