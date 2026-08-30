import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCliArguments } from '../src/cli/arguments.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = resolve(ROOT, 'bin', 'agent-loop.mjs')

function runCli(...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? ROOT,
      LANG: process.env.LANG ?? 'C.UTF-8',
    },
  })
}

test('--help prints the supported command surface and exits zero', () => {
  const result = runCli('--help')

  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout, `agent-loop 0.1.0

Usage:
  agent-loop <command> [options]

Commands:
  doctor  Check whether a target repository is safe and ready
  run     Run one bounded bug-fix transaction

Global options:
  --help
  --version
`)
})

test('--version prints the package version and exits zero', () => {
  const packageMetadata = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
  const result = runCli('--version')

  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout, `${packageMetadata.version}\n`)
})

test('missing command exits two without a stack trace', () => {
  const result = runCli()

  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, "error: a command is required\nTry 'agent-loop --help' for usage.\n")
  assert.doesNotMatch(result.stderr, /\bat\s+\S+|Error:/)
})

test('unknown command exits two without a stack trace', () => {
  const result = runCli('deploy')

  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, "error: unknown command: deploy\nTry 'agent-loop --help' for usage.\n")
  assert.doesNotMatch(result.stderr, /\bat\s+\S+|Error:/)
})

test('value option without a value exits two', () => {
  const result = runCli('doctor', '--repo')

  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, "error: option --repo requires a value\nTry 'agent-loop --help' for usage.\n")
})

test('duplicate singleton option exits two', () => {
  const result = runCli('doctor', '--repo', '/tmp/one', '--repo', '/tmp/two')

  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, "error: option --repo may only be provided once\nTry 'agent-loop --help' for usage.\n")
})

test('arguments after a separator are rejected instead of passed through', () => {
  const result = runCli('run', '--repo', '/tmp/repo', '--', 'git', 'push')

  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, "error: argument separator -- is not supported\nTry 'agent-loop --help' for usage.\n")
})

test('doctor options parse into a typed command request', () => {
  assert.deepEqual(
    parseCliArguments([
      'doctor',
      '--repo', '/tmp/repository',
      '--config', '/tmp/config.json',
      '--state-root', '/tmp/state',
      '--json',
    ]),
    {
      kind: 'command',
      command: 'doctor',
      options: {
        repo: '/tmp/repository',
        config: '/tmp/config.json',
        stateRoot: '/tmp/state',
        json: true,
      },
    },
  )
})

test('run options parse into a typed command request', () => {
  assert.deepEqual(
    parseCliArguments([
      'run',
      '--repo', '/tmp/repository',
      '--work-item', '/tmp/work-item.md',
      '--config', '/tmp/config.json',
      '--state-root', '/tmp/state',
      '--acknowledge-unsandboxed-credential-access',
      '--json',
    ]),
    {
      kind: 'command',
      command: 'run',
      options: {
        repo: '/tmp/repository',
        workItem: '/tmp/work-item.md',
        config: '/tmp/config.json',
        stateRoot: '/tmp/state',
        acknowledgeUnsandboxedCredentialAccess: true,
        json: true,
      },
    },
  )
})

test('package archive contains only the maintained runtime surface', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? ROOT,
      LANG: process.env.LANG ?? 'C.UTF-8',
    },
  })

  assert.equal(result.status, 0, result.stderr)
  const [archive] = JSON.parse(result.stdout)
  const paths = archive.files.map((file) => file.path)
  assert.ok(paths.includes('bin/agent-loop.mjs'))
  assert.ok(paths.includes('src/cli/arguments.mjs'))
  assert.ok(paths.includes('examples/config.json'))
  assert.ok(paths.includes('package.json'))
  assert.equal(
    paths.some((path) => /^(?:\.hermes|orchestrator|pipelines|spikes|vault)\//.test(path)),
    false,
  )
})
