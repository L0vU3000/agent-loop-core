// Regression check for the work-item checker. Drives the pure checkWorkItem() against a fixture
// registry — no filesystem. Proves a well-formed item passes and routes, and that each way a
// draft can be under-specified (bad type, mismatched category, no Done line) is caught.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkWorkItem } from '../orchestrator/check-work-item.mjs'

// A registry stub shaped like validatePipelineRegistry().definitions, keyed by type.
const byType = new Map([
  ['bug', { name: 'bug-fix', category: 'building', type: 'bug' }],
  ['e2e', { name: 'e2e-regression', category: 'testing', type: 'e2e' }],
  ['lint', { name: 'eslint-burndown', category: 'maintenance', type: 'lint' }],
])

const goodItem = [
  '---',
  'category: testing',
  'type: e2e',
  'priority: normal',
  'created: 2026-07-17',
  '---',
  '',
  '# De-flake the bulk-action bar',
  '',
  '"Done" = F4 runs green in two consecutive full active suites.',
  '',
  '## Do NOT',
  '- Do not paper over it with { force: true } or a widened timeout.',
].join('\n')

test('a well-formed item passes and reports its route', () => {
  const result = checkWorkItem(goodItem, byType)
  assert.equal(result.ok, true)
  assert.deepEqual(result.problems, [])
  assert.equal(result.routing.pipeline, 'e2e-regression')
  assert.equal(result.routing.category, 'testing')
})

test('missing frontmatter is a hard problem', () => {
  const result = checkWorkItem('# just a title\nsome text', byType)
  assert.equal(result.ok, false)
  assert.match(result.problems[0], /missing frontmatter/)
})

test('an unknown type is caught and the valid types are listed', () => {
  const item = goodItem.replace('type: e2e', 'type: e2ee')
  const result = checkWorkItem(item, byType)
  assert.equal(result.ok, false)
  assert.match(result.problems.join(' '), /unknown type "e2ee"/)
  assert.match(result.problems.join(' '), /bug, e2e, lint/)
})

test('a category that does not match the type is caught', () => {
  const item = goodItem.replace('category: testing', 'category: building')
  const result = checkWorkItem(item, byType)
  assert.equal(result.ok, false)
  assert.match(result.problems.join(' '), /does not match type "e2e"/)
})

test('a missing Done line blocks the item', () => {
  const item = goodItem.replace('"Done" = F4 runs green in two consecutive full active suites.', 'Fix the bar.')
  const result = checkWorkItem(item, byType)
  assert.equal(result.ok, false)
  assert.match(result.problems.join(' '), /no testable "Done ="/)
})

test('missing boundaries is a warning, not a block', () => {
  const item = goodItem.split('\n## Do NOT')[0]
  const result = checkWorkItem(item, byType)
  assert.equal(result.ok, true, 'still routable without a Do NOT section')
  assert.match(result.warnings.join(' '), /boundaries/)
})
