import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const GIT_BINARY = '/usr/bin/git'
const COMMAND_TIMEOUT_MS = 30_000
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024

function git(cwd, ...args) {
  const environment = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: cwd,
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    LANG: process.env.LANG ?? 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    XDG_CONFIG_HOME: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    NO_COLOR: '1',
  }
  return execFileSync(GIT_BINARY, [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false',
    '-c', 'commit.gpgSign=false',
    ...args,
  ], {
    cwd,
    encoding: 'utf8',
    env: environment,
    timeout: COMMAND_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  }).trim()
}

export function copyControlPlaneFixture(agentLoopSourceRoot, destinationRoot) {
  mkdirSync(join(destinationRoot, 'pipelines'), { recursive: true })
  mkdirSync(join(destinationRoot, 'orchestrator', 'inbox'), { recursive: true })
  writeFileSync(join(destinationRoot, 'orchestrator', 'dispatch-log.md'), '')
  cpSync(join(agentLoopSourceRoot, 'categories.md'), join(destinationRoot, 'categories.md'))
  cpSync(join(agentLoopSourceRoot, 'pipelines', 'README.md'), join(destinationRoot, 'pipelines', 'README.md'))
  cpSync(join(agentLoopSourceRoot, 'orchestrator', 'orchestrator.md'), join(destinationRoot, 'orchestrator', 'orchestrator.md'))

  for (const entry of readdirSync(join(agentLoopSourceRoot, 'pipelines'))) {
    const sourceDirectory = join(agentLoopSourceRoot, 'pipelines', entry)
    if (!statSync(sourceDirectory).isDirectory()) continue
    const destinationDirectory = join(destinationRoot, 'pipelines', entry)
    mkdirSync(destinationDirectory, { recursive: true })
    cpSync(join(sourceDirectory, 'pipeline.md'), join(destinationDirectory, 'pipeline.md'))
    const workflow = join(sourceDirectory, 'workflow.js')
    if (existsSync(workflow)) cpSync(workflow, join(destinationDirectory, 'workflow.js'))
  }
}

export function createBrokenRepository(repositoryRoot, {
  dirtyOnObjective = false,
  hostileGitConfig = false,
  missingExpectedDefect = false,
} = {}) {
  mkdirSync(join(repositoryRoot, 'src'), { recursive: true })
  mkdirSync(join(repositoryRoot, 'test'), { recursive: true })
  writeFileSync(join(repositoryRoot, 'package.json'), '{"type":"module","scripts":{"test":"node --test"}}\n')
  writeFileSync(
    join(repositoryRoot, 'src', 'add.mjs'),
    missingExpectedDefect
      ? 'export function add(a, b) { return a * b }\n'
      : 'export function add(a, b) { return a - b }\n',
  )
  const testLines = [
    "import assert from 'node:assert/strict'",
    "import test from 'node:test'",
    "import { writeFileSync } from 'node:fs'",
    "import { add } from '../src/add.mjs'",
    "test('adds two numbers', () => assert.equal(add(2, 3), 5))",
    "test('does not inherit parent secrets', () => assert.equal(process.env.SPIKE_SECRET_SENTINEL, undefined))",
  ]
  if (dirtyOnObjective) {
    testLines.push("test('objective side effect', () => { if (process.env.AGENT_LOOP_OBJECTIVE_PHASE === '1') writeFileSync('post-objective-test.txt', 'dirty\\n') })")
  }
  testLines.push('')
  writeFileSync(join(repositoryRoot, 'test', 'add.test.mjs'), testLines.join('\n'))

  if (hostileGitConfig) {
    mkdirSync(join(repositoryRoot, 'hostile-hooks'), { recursive: true })
    writeFileSync(join(repositoryRoot, '.gitconfig'), '[core]\n\thooksPath = hostile-hooks\n')
    const hook = join(repositoryRoot, 'hostile-hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\nprintf "hook-ran\\n" > hook-ran.txt\n')
    chmodSync(hook, 0o755)
  }

  git(repositoryRoot, 'init', '-b', 'main')
  git(repositoryRoot, 'config', 'user.name', 'Spike Fixture')
  git(repositoryRoot, 'config', 'user.email', 'spike@example.invalid')
  git(repositoryRoot, 'add', '.')
  git(repositoryRoot, 'commit', '-m', 'fixture: introduce failing add implementation')
  return git(repositoryRoot, 'rev-parse', 'HEAD')
}

export function writeBugItem(root, filename = '10-fix-add.md') {
  writeFileSync(join(root, 'orchestrator', 'inbox', filename), [
    '---',
    'category: building',
    'type: bug',
    'priority: high',
    '---',
    '',
    'Fix src/add.mjs so the existing test passes.',
    '',
  ].join('\n'))
}
