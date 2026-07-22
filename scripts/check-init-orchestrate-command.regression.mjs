import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function makeProject() {
  const project = mkdtempSync(join(tmpdir(), 'agent-loop-init-'))
  const agentLoop = join(project, 'agent-loop')
  cpSync(CORE_ROOT, agentLoop, {
    recursive: true,
    filter: (source) => !source.split(sep).includes('.git'),
  })
  mkdirSync(join(project, '.git'))
  return { project, agentLoop }
}

function runInit(agentLoop) {
  const result = spawnSync(process.execPath, [join(agentLoop, 'init.mjs')], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

test('init installs the bundled command at the consuming project root', () => {
  const { project, agentLoop } = makeProject()
  try {
    const destination = join(project, '.claude', 'commands', 'orchestrate.md')
    const source = join(agentLoop, '.claude', 'commands', 'orchestrate.md')

    const output = runInit(agentLoop)

    assert.equal(existsSync(destination), true)
    assert.equal(readFileSync(destination, 'utf8'), readFileSync(source, 'utf8'))
    assert.match(output, /Installed Claude command/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('init preserves a consuming project command that already exists', () => {
  const { project, agentLoop } = makeProject()
  try {
    const destination = join(project, '.claude', 'commands', 'orchestrate.md')
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, 'project-specific command\n')

    const output = runInit(agentLoop)

    assert.equal(readFileSync(destination, 'utf8'), 'project-specific command\n')
    assert.match(output, /Kept existing project command/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
