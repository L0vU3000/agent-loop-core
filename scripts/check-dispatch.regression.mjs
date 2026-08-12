import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir as operatingSystemTemporaryDirectory } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  claimItem,
  itemCategory,
  MAX_GRAPH_DEPTH,
  planDispatch,
  proposeNext,
  reclaimItem,
  recordOutcome,
  STALE_CLAIM_MS,
} from '../orchestrator/dispatch.mjs'
import { checkWorkItem } from '../orchestrator/check-work-item.mjs'
import { validatePipelineRegistry } from './check-pipeline-registry.mjs'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const SOURCE_ROOT = resolve(SCRIPT_DIRECTORY, '..')

// Copy just enough of the real agent-loop for validatePipelineRegistry to pass in the fixture:
// the three registry docs plus every pipeline's frontmatter. The dispatcher reads its routing
// table from that same canonical source, so the fixture exercises the real registry.
function copyRegistryFixture(destinationRoot) {
  mkdirSync(join(destinationRoot, 'pipelines'), { recursive: true })
  mkdirSync(join(destinationRoot, 'orchestrator'), { recursive: true })
  cpSync(join(SOURCE_ROOT, 'categories.md'), join(destinationRoot, 'categories.md'))
  cpSync(join(SOURCE_ROOT, 'pipelines', 'README.md'), join(destinationRoot, 'pipelines', 'README.md'))
  cpSync(join(SOURCE_ROOT, 'orchestrator', 'orchestrator.md'), join(destinationRoot, 'orchestrator', 'orchestrator.md'))
  for (const entry of readdirSync(join(SOURCE_ROOT, 'pipelines'))) {
    const sourceDirectory = join(SOURCE_ROOT, 'pipelines', entry)
    if (!statSync(sourceDirectory).isDirectory()) {
      continue
    }
    const destinationDirectory = join(destinationRoot, 'pipelines', entry)
    mkdirSync(destinationDirectory, { recursive: true })
    cpSync(join(sourceDirectory, 'pipeline.md'), join(destinationDirectory, 'pipeline.md'))
  }
}

function writeItem(inboxDirectory, name, frontmatter) {
  const body = frontmatter
    ? `---\n${Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\nwork item\n`
    : 'no frontmatter here\n'
  writeFileSync(join(inboxDirectory, name), body)
}

test('dispatcher routes valid items, rejects mismatches, orders by priority, records outcomes', () => {
  const fixtureRoot = mkdtempSync(join(operatingSystemTemporaryDirectory(), 'dispatch-check-'))

  try {
    copyRegistryFixture(fixtureRoot)
    const inbox = join(fixtureRoot, 'orchestrator', 'inbox')
    mkdirSync(inbox, { recursive: true })

    // Two well-formed items on real registry pairs, plus three that must be rejected.
    writeItem(inbox, '05-e2e-high.md', { category: 'testing', type: 'e2e', priority: 'high', created: '2026-07-16' })
    writeItem(inbox, '10-lint-normal.md', { category: 'maintenance', type: 'lint', priority: 'normal', created: '2026-07-16' })
    writeItem(inbox, '20-mismatch.md', { category: 'building', type: 'e2e', priority: 'normal', created: '2026-07-16' })
    writeItem(inbox, '30-unknown-type.md', { category: 'building', type: 'banana', priority: 'normal', created: '2026-07-16' })
    writeItem(inbox, '40-no-frontmatter.md', null)
    // An archived item under done/ must be ignored, not routed.
    mkdirSync(join(inbox, 'done'), { recursive: true })
    writeItem(join(inbox, 'done'), '00-archived.md', { category: 'testing', type: 'e2e' })

    const plan = planDispatch(fixtureRoot)
    assert.equal(plan.registryOk, true, plan.registryErrors.join('\n'))

    // Routing: two routable, three invalid; archived item ignored.
    assert.equal(plan.routable.length, 2, JSON.stringify(plan.routable))
    assert.equal(plan.invalid.length, 3, JSON.stringify(plan.invalid))

    // Priority order: high before normal, regardless of filename.
    assert.equal(plan.routable[0].file, '05-e2e-high.md')
    assert.equal(plan.routable[0].pipeline, 'e2e-regression')
    assert.equal(plan.routable[1].file, '10-lint-normal.md')
    assert.equal(plan.routable[1].pipeline, 'eslint-burndown')

    // Each invalid item carries a specific, actionable reason.
    const reasonFor = (file) => plan.invalid.find((item) => item.file === file)?.reason ?? ''
    assert.match(reasonFor('20-mismatch.md'), /does not match pipeline/)
    assert.match(reasonFor('30-unknown-type.md'), /no pipeline registered for type "banana"/)
    assert.match(reasonFor('40-no-frontmatter.md'), /missing category\/type frontmatter/)

    // Bookkeeping: recording a pass moves the item into done/ and drops it from the next plan.
    recordOutcome(fixtureRoot, '10-lint-normal.md', 'pass', 'green')
    assert.ok(!existsSync(join(inbox, '10-lint-normal.md')), 'recorded item must leave the inbox root')
    assert.ok(existsSync(join(inbox, 'done', '10-lint-normal.md')), 'recorded item must land in done/')

    const afterPlan = planDispatch(fixtureRoot)
    assert.equal(afterPlan.routable.length, 1, 'the recorded item is no longer pending')
    assert.equal(afterPlan.routable[0].file, '05-e2e-high.md')

    // Security: a file argument with a directory part or "../" must be rejected before it can
    // rename a file outside the inbox (path traversal).
    for (const evil of ['../escape.md', 'sub/dir.md', '..', '/etc/passwd', '']) {
      assert.throws(
        () => recordOutcome(fixtureRoot, evil, 'pass'),
        /plain filename/,
        `traversal filename must be rejected: ${evil}`,
      )
    }
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})

test('claiming an item hides it from the next dispatch; a stale claim is reclaimable; a claimed item still records', () => {
  const fixtureRoot = mkdtempSync(join(operatingSystemTemporaryDirectory(), 'dispatch-claim-'))

  try {
    copyRegistryFixture(fixtureRoot)
    const inbox = join(fixtureRoot, 'orchestrator', 'inbox')
    mkdirSync(inbox, { recursive: true })

    // A single well-formed, routable item on a real registry pair (maintenance/lint ->
    // eslint-burndown). The whole claim lifecycle plays out against just this one item.
    writeItem(inbox, '10-lint-normal.md', { category: 'maintenance', type: 'lint', priority: 'normal', created: '2026-07-19' })

    // Baseline: the item is routable before any claim.
    const before = planDispatch(fixtureRoot)
    assert.ok(
      before.routable.some((item) => item.file === '10-lint-normal.md'),
      'the fixture item must be routable before it is claimed',
    )

    // (1) After claimItem, the very next planDispatch() must EXCLUDE the item from BOTH routable
    // AND invalid — a claimed item is neither pending work nor a validation error, it is in-flight.
    const claim = claimItem(fixtureRoot, '10-lint-normal.md')
    assert.equal(claim.moved, 'inbox/in-progress/10-lint-normal.md')
    assert.ok(
      existsSync(join(inbox, 'in-progress', '10-lint-normal.md')),
      'claimed item must physically move into inbox/in-progress/',
    )
    assert.ok(
      !existsSync(join(inbox, '10-lint-normal.md')),
      'claimed item must no longer sit at the top-level inbox',
    )

    const afterClaim = planDispatch(fixtureRoot)
    assert.ok(
      !afterClaim.routable.some((item) => item.file === '10-lint-normal.md'),
      'a claimed item must not appear in the next dispatch routable list',
    )
    assert.ok(
      !afterClaim.invalid.some((item) => item.file === '10-lint-normal.md'),
      'a claimed item must not appear in the next dispatch invalid list either',
    )

    // (2) reclaimItem on a FRESH claim must throw — an in-flight run must not be yanked out.
    assert.throws(
      () => reclaimItem(fixtureRoot, '10-lint-normal.md'),
      /not stale/,
      'a fresh claim must not be reclaimable',
    )
    assert.ok(
      existsSync(join(inbox, 'in-progress', '10-lint-normal.md')),
      'a rejected reclaim must leave the item claimed',
    )

    // (3) Backdate the claimed file's mtime past STALE_CLAIM_MS. reclaimItem must now succeed and
    // return the item to the top-level inbox, where it is routable again.
    const stalePast = new Date(Date.now() - STALE_CLAIM_MS - 60 * 1000)
    utimesSync(join(inbox, 'in-progress', '10-lint-normal.md'), stalePast, stalePast)
    const reclaim = reclaimItem(fixtureRoot, '10-lint-normal.md')
    assert.equal(reclaim.moved, 'inbox/10-lint-normal.md')
    assert.ok(
      existsSync(join(inbox, '10-lint-normal.md')),
      'a stale claim must be returned to the top-level inbox',
    )
    assert.ok(
      !existsSync(join(inbox, 'in-progress', '10-lint-normal.md')),
      'a reclaimed item must leave inbox/in-progress/',
    )
    const afterReclaim = planDispatch(fixtureRoot)
    assert.ok(
      afterReclaim.routable.some((item) => item.file === '10-lint-normal.md'),
      'a reclaimed item must be routable again',
    )

    // (4) A CLAIMED item must still resolve for --record: itemCategory reads its frontmatter from
    // in-progress/, and recordOutcome archives it into done/ (not "inbox item not found").
    claimItem(fixtureRoot, '10-lint-normal.md')
    assert.equal(
      itemCategory(fixtureRoot, '10-lint-normal.md'),
      'maintenance',
      'itemCategory must resolve a claimed item from in-progress/',
    )
    const recorded = recordOutcome(fixtureRoot, '10-lint-normal.md', 'pass', 'green')
    assert.equal(recorded.moved, 'inbox/done/10-lint-normal.md')
    assert.ok(
      existsSync(join(inbox, 'done', '10-lint-normal.md')),
      'a claimed item recorded pass must land in done/',
    )
    assert.ok(
      !existsSync(join(inbox, 'in-progress', '10-lint-normal.md')),
      'a recorded claimed item must leave inbox/in-progress/',
    )

    // The traversal guard still protects the claim/reclaim rename paths, exactly as it does
    // recordOutcome — the guard is shared, so it cannot drift between the three.
    for (const evil of ['../escape.md', 'sub/dir.md', '..', '']) {
      assert.throws(() => claimItem(fixtureRoot, evil), /plain filename/, `claim must reject ${evil}`)
      assert.throws(() => reclaimItem(fixtureRoot, evil), /plain filename/, `reclaim must reject ${evil}`)
    }
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})

test('a graph edge proposes an inert successor draft: unroutable, un-armable, provenance-carrying, depth-capped', () => {
  const fixtureRoot = mkdtempSync(join(operatingSystemTemporaryDirectory(), 'dispatch-edge-'))

  try {
    copyRegistryFixture(fixtureRoot)
    const inbox = join(fixtureRoot, 'orchestrator', 'inbox')
    mkdirSync(inbox, { recursive: true })

    // A planning item that passes and hands off to a building pipeline — the canonical edge
    // (research answers the question; the change it implies is a separate node's job).
    writeItem(inbox, '10-research.md', { category: 'planning', type: 'research', priority: 'high', created: '2026-08-12' })
    recordOutcome(fixtureRoot, '10-research.md', 'pass', 'report ready')

    const edge = proposeNext(fixtureRoot, '10-research.md', ['feature'], { summary: 'report ready', today: '2026-08-12' })
    assert.deepEqual(edge.written, ['inbox/next/10-research--feature.md'])
    assert.equal(edge.depth, 1)

    const draftPath = join(inbox, 'next', '10-research--feature.md')
    const draft = readFileSync(draftPath, 'utf8')

    // (1) INERT: the draft must be invisible to the router — inbox/next/ is not the inbox.
    const plan = planDispatch(fixtureRoot)
    assert.equal(plan.routable.length, 0, 'a proposed edge must not be routable')
    assert.equal(plan.invalid.length, 0, 'a proposed edge must not even appear as an invalid item')

    // (2) UN-ARMABLE: dropped into the inbox as-is, the checker must still reject it for having no
    // exit condition. This is the guard against inheriting the predecessor's "Done" line and
    // shipping work nobody verified.
    const registry = validatePipelineRegistry(fixtureRoot)
    const byType = new Map(registry.definitions.map((definition) => [definition.type, definition]))
    const verdict = checkWorkItem(draft, byType)
    assert.equal(verdict.ok, false, 'an unedited edge draft must not pass the work-item checker')
    assert.ok(
      verdict.problems.some((problem) => /done/i.test(problem)),
      `rejection must be about the missing exit condition, got: ${verdict.problems.join(' | ')}`,
    )

    // (3) PROVENANCE + correct routing metadata: the edge resolves the successor's category from
    // the registry (never copies the predecessor's), and records where it came from.
    assert.match(draft, /^category: building$/m)
    assert.match(draft, /^type: feature$/m)
    assert.match(draft, /^from: 10-research\.md$/m)
    assert.match(draft, /^depth: 1$/m)
    assert.match(draft, /inbox\/done\/10-research\.md/, 'state travels by reference to the upstream item')

    // (4) NOT CLOBBERED: re-proposing leaves an edited draft alone.
    writeFileSync(draftPath, 'hand-edited\n')
    const again = proposeNext(fixtureRoot, '10-research.md', ['feature'], { today: '2026-08-12' })
    assert.deepEqual(again.written, [])
    assert.deepEqual(again.skipped, ['inbox/next/10-research--feature.md'])
    assert.equal(readFileSync(draftPath, 'utf8'), 'hand-edited\n')

    // (5) DEPTH CAP: a chain at the cap must refuse another hop rather than cycle forever.
    writeItem(inbox, '20-deep.md', {
      category: 'planning', type: 'research', priority: 'normal', created: '2026-08-12', depth: MAX_GRAPH_DEPTH,
    })
    recordOutcome(fixtureRoot, '20-deep.md', 'pass', 'deep')
    assert.throws(
      () => proposeNext(fixtureRoot, '20-deep.md', ['feature']),
      /exceeds the cap/,
      'the graph must be bounded — a hop past the cap needs a human, not another node',
    )

    // (6) An unregistered successor type is a hard error, not a silently written draft.
    assert.throws(() => proposeNext(fixtureRoot, '10-research.md', ['banana']), /no pipeline registered/)
    assert.throws(() => proposeNext(fixtureRoot, '10-research.md', []), /at least one/)

    // The shared traversal guard covers this rename/write path too.
    for (const evil of ['../escape.md', 'sub/dir.md', '..', '']) {
      assert.throws(() => proposeNext(fixtureRoot, evil, ['feature']), /plain filename/, `propose must reject ${evil}`)
    }
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})
