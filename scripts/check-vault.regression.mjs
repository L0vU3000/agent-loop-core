import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { listFiles, validateVault } from './check-vault.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMP_ROOTS = []

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-vault-'))
  TEMP_ROOTS.push(root)

  for (const path of ['.obsidian', 'vault']) cpSync(join(REPO_ROOT, path), join(root, path), { recursive: true })
  for (const path of [
    '.gitignore',
    'README.md',
    'STACK.md',
    'agent-loop.md',
    'categories.md',
    'orchestrator/orchestrator.md',
    'orchestrator/dispatch-log.md',
    'pipelines/README.md',
    'pipelines/EVAL.md',
    'pipelines/pipeline-improve/pipeline.md',
    'memory/README.md',
    'memory/errors.md',
    'memory/decisions.md',
    'memory/changelog.md',
    'resources/README.md',
    'skills-library.md',
  ]) {
    const destination = join(root, path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(join(REPO_ROOT, path), destination)
  }
  return root
}

function validateFixture(root) {
  return validateVault(root, { trackedFiles: listFiles(root) })
}

test.after(() => {
  for (const root of TEMP_ROOTS) rmSync(root, { recursive: true, force: true })
})

test('the committed vault satisfies every invariant', () => {
  assert.deepEqual(validateVault(REPO_ROOT), [])
})

test('missing operational paths and broken home links fail closed', () => {
  const root = makeFixture()
  unlinkSync(join(root, 'pipelines/EVAL.md'))
  const home = join(root, 'vault/obsidian.md')
  writeFileSync(home, readFileSync(home, 'utf8').replace('[[README|Public README]]', '[[missing-note]]'))

  const errors = validateFixture(root)
  assert(errors.some((error) => error.includes('pipelines/EVAL.md: required path is missing')))
  assert(errors.some((error) => error.includes('unresolved wikilink [[missing-note]]')))
  assert(errors.some((error) => error.includes('missing Map of Content link [[README]]')))
})

test('invalid curated frontmatter is rejected', () => {
  const root = makeFixture()
  const note = join(root, 'vault/architecture/system-overview.md')
  writeFileSync(note, readFileSync(note, 'utf8').replace('status: active', 'status: private'))

  assert(validateFixture(root).some((error) => error.includes("unsupported status 'private'")))
})

test('tracked personal Obsidian state and generated run state are rejected', () => {
  const root = makeFixture()
  writeFileSync(join(root, '.obsidian/workspace.json'), '{}\n')
  mkdirSync(join(root, '.obsidian/plugins/example'), { recursive: true })
  writeFileSync(join(root, '.obsidian/plugins/example/data.json'), '{}\n')
  mkdirSync(join(root, 'pipelines/example/runs/run-1'), { recursive: true })
  writeFileSync(join(root, 'pipelines/example/runs/run-1/eval.md'), 'verdict: pass\n')

  const errors = validateFixture(root)
  assert.equal(errors.filter((error) => error.includes('personal Obsidian state must not be tracked')).length, 2)
  assert(errors.some((error) => error.includes('generated or project-private state must not be tracked')))
})

test('external citations are allowed but internal Markdown links are rejected', () => {
  const root = makeFixture()
  const note = join(root, 'vault/research/README.md')
  writeFileSync(
    note,
    `${readFileSync(note, 'utf8')}\n[External source](https://example.com)\n[Internal](../architecture/system-overview.md)\n`,
  )

  const errors = validateFixture(root)
  assert.equal(errors.filter((error) => error.includes('https://example.com')).length, 0)
  assert(errors.some((error) => error.includes("internal Markdown link '../architecture/system-overview.md'")))
})
