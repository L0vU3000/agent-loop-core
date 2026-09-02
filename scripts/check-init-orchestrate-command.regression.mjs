import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function makeProject() {
  const project = mkdtempSync(join(tmpdir(), 'agent-control-plane-init-'))
  const controlPlane = join(project, 'agent-control-plane')
  cpSync(CORE_ROOT, controlPlane, {
    recursive: true,
    filter: (source) => !source.split(sep).includes('.git'),
  })
  mkdirSync(join(project, '.git'))
  return { project, controlPlane }
}

function runInit(controlPlane) {
  const result = spawnSync(process.execPath, [join(controlPlane, 'init.mjs')], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

test('init installs the bundled command at the consuming project root', () => {
  const { project, controlPlane } = makeProject()
  try {
    const destination = join(project, '.claude', 'commands', 'orchestrate.md')
    const source = join(controlPlane, '.claude', 'commands', 'orchestrate.md')

    const output = runInit(controlPlane)

    assert.equal(existsSync(destination), true)
    assert.equal(readFileSync(destination, 'utf8'), readFileSync(source, 'utf8'))
    assert.match(output, /Installed Claude command/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('init preserves a consuming project command that already exists', () => {
  const { project, controlPlane } = makeProject()
  try {
    const destination = join(project, '.claude', 'commands', 'orchestrate.md')
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, 'project-specific command\n')

    const output = runInit(controlPlane)

    assert.equal(readFileSync(destination, 'utf8'), 'project-specific command\n')
    assert.match(output, /Kept existing project command/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

// Adding a queue directory without teaching init to clear it is the recurring bug this guards:
// stale instance data rides into a fresh project and looks like real work. Assert EVERY queue
// directory is reset, so the next one added fails here instead of in someone's new repo.
test('init clears stale items from every inbox queue directory', () => {
  const { project, controlPlane } = makeProject()
  try {
    const queues = ['', 'done', 'failed', 'in-progress', 'next']
    const stale = queues.map((queue) => {
      const directory = join(controlPlane, 'orchestrator', 'inbox', queue)
      mkdirSync(directory, { recursive: true })
      const file = join(directory, 'zz-stale.md')
      writeFileSync(file, '---\ncategory: maintenance\ntype: lint\n---\n\nleftover from another project\n')
      return file
    })

    runInit(controlPlane)

    for (const file of stale) {
      assert.equal(existsSync(file), false, `init must clear stale instance data at ${file}`)
    }
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
