import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
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
  planDispatch,
  reclaimItem,
  recordOutcome,
  STALE_CLAIM_MS,
} from '../orchestrator/dispatch.mjs'

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
