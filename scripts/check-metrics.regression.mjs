// Regression check for the metrics collector's pure row-builder. Drives toRow() against a
// fixture shaped like a real runtime workflow JSON — no filesystem, no live runs.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toRow } from '../orchestrator/metrics.mjs'

const REPO = '/repo'

function sampleWorkflow(overrides = {}) {
  return {
    runId: 'wf_test_0001',
    workflowName: 'bug-fix',
    scriptPath: '/repo/agent-loop/pipelines/bug-fix/workflow.js',
    args: 'agent-loop/orchestrator/inbox/2026-07-16-some-bug.md',
    status: 'completed',
    timestamp: '2026-07-16T04:00:00.000Z',
    defaultModel: 'claude-opus-4-8[1m]',
    totalTokens: 120000,
    durationMs: 300000,
    totalToolCalls: 40,
    agentCount: 5,
    result: { fixed: true, iterations: 2 },
    workflowProgress: [
      { type: 'workflow_phase', index: 1, title: 'Reproduce' },
      { type: 'workflow_agent', label: 'explore', phaseTitle: 'Reproduce', model: 'claude-sonnet-5', tokens: 20000, durationMs: 30000, toolCalls: 6, attempt: 1, queuedAt: 100, startedAt: 150 },
      { type: 'workflow_agent', label: 'plan#1', phaseTitle: 'Fix loop', model: 'claude-sonnet-5', tokens: 10000, durationMs: 15000, toolCalls: 2, attempt: 1 },
      { type: 'workflow_agent', label: 'execute#1', phaseTitle: 'Fix loop', model: 'claude-opus-4-8', tokens: 40000, durationMs: 60000, toolCalls: 10, attempt: 1 },
      { type: 'workflow_agent', label: 'eval#1', phaseTitle: 'Fix loop', model: 'claude-sonnet-5', tokens: 25000, durationMs: 40000, toolCalls: 8, attempt: 1 },
      { type: 'workflow_agent', label: 'eval#2', phaseTitle: 'Fix loop', model: 'claude-sonnet-5', tokens: 25000, durationMs: 40000, toolCalls: 8, attempt: 1 },
    ],
    ...overrides,
  }
}

test('toRow maps run-level cost and the result object', () => {
  const row = toRow(sampleWorkflow(), REPO)
  assert.equal(row.runId, 'wf_test_0001')
  assert.equal(row.pipeline, 'bug-fix')
  assert.equal(row.totalTokens, 120000)
  assert.equal(row.durationMs, 300000)
  assert.deepEqual(row.result, { fixed: true, iterations: 2 })
})

test('toRow parses the ticket path out of args', () => {
  const row = toRow(sampleWorkflow(), REPO)
  assert.equal(row.ticket, 'agent-loop/orchestrator/inbox/2026-07-16-some-bug.md')
})

test('toRow captures one stage row per workflow_agent with per-stage cost', () => {
  const row = toRow(sampleWorkflow(), REPO)
  assert.equal(row.stages.length, 5)
  const explore = row.stages[0]
  assert.equal(explore.label, 'explore')
  assert.equal(explore.model, 'claude-sonnet-5')
  assert.equal(explore.tokens, 20000)
  assert.equal(explore.queueMs, 50) // startedAt - queuedAt
})

test('iterations counts eval stages (plan->execute->eval laps)', () => {
  const row = toRow(sampleWorkflow(), REPO)
  assert.equal(row.iterations, 2)
})

test('toRow rejects a run from another repo', () => {
  const foreign = sampleWorkflow({ scriptPath: '/other/project/workflow.js' })
  assert.equal(toRow(foreign, REPO), null)
})

test('toRow rejects an unfinished run', () => {
  const running = sampleWorkflow({ status: 'running', durationMs: null })
  assert.equal(toRow(running, REPO), null)
})
