// Regression check for the record gate — the doorway that re-verifies a claimed PASS before it
// is trusted. Tests the PURE decision + category logic (no shell, no filesystem), proving the
// gate can only ever make a verdict stricter and never upgrades or false-fails.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decideRecord, isGateBearing } from '../orchestrator/dispatch.mjs'

const green = { checked: true, passed: true, detail: 'machinery + tsc green' }
const red = { checked: true, passed: false, detail: 'tsc failed' }
const couldNotRun = { checked: false, passed: false, detail: 'no objective check could run (skipped)' }

test('claimed pass + gates green → recorded pass', () => {
  const d = decideRecord({ claimed: 'pass', gate: green, skipGate: false })
  assert.equal(d.outcome, 'pass')
  assert.equal(d.note, '')
})

test('claimed pass + gates red → DOWNGRADED to fail, with a note', () => {
  const d = decideRecord({ claimed: 'pass', gate: red, skipGate: false })
  assert.equal(d.outcome, 'fail')
  assert.match(d.note, /overruled by record gate/)
})

test('claimed pass + --skip-gate → recorded pass, no override', () => {
  const d = decideRecord({ claimed: 'pass', gate: red, skipGate: true })
  assert.equal(d.outcome, 'pass')
})

test('claimed pass + read-only pipeline (no gate) → recorded pass', () => {
  const d = decideRecord({ claimed: 'pass', gate: null, skipGate: false })
  assert.equal(d.outcome, 'pass')
})

test('claimed pass + gates could not run → recorded pass (skip, do not false-fail)', () => {
  const d = decideRecord({ claimed: 'pass', gate: couldNotRun, skipGate: false })
  assert.equal(d.outcome, 'pass')
})

test('claimed fail is never upgraded — even when the gates are green', () => {
  assert.equal(decideRecord({ claimed: 'fail', gate: green, skipGate: false }).outcome, 'fail')
  assert.equal(decideRecord({ claimed: 'fail', gate: red, skipGate: false }).outcome, 'fail')
})

test('gate-bearing categories are exactly the code-changing ones', () => {
  for (const category of ['building', 'testing', 'maintenance']) assert.ok(isGateBearing(category))
  for (const category of ['planning', 'review', 'delivery', 'nonsense']) assert.ok(!isGateBearing(category))
})
