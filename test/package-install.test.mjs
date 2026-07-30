import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NETWORK_GIT_TOKENS = [
  'push',
  'fetch',
  'pull',
  'clone',
  'merge',
  'ls-remote',
  'remote',
  'submodule',
  'send-pack',
  'receive-pack',
  'upload-pack',
  'upload-archive',
]
const NETWORK_TARGET = /(?:https?|ssh|git):\/\/|git@/u
const SECRET_MARKERS = [
  'zzz-unsandboxed-parent-secret-zzz',
  'aaa-fake-aws-secret-access-key-aaa',
]

function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', [
    '--no-optional-locks',
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false',
    '-c', 'commit.gpgSign=false',
    '-C', cwd,
    ...args,
  ], {
    encoding: 'utf8',
    env: {
      HOME: cwd,
      PATH: '/usr/bin:/bin',
      LANG: 'C.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      XDG_CONFIG_HOME: '/dev/null',
    },
    timeout: 30_000,
  }).trim()
}

function packTarball(destinationDir) {
  const result = spawnSync('npm', ['pack', '--json', '--pack-destination', destinationDir], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (result.status !== 0) {
    throw new Error(`npm pack failed (status ${result.status}): ${result.stderr}`)
  }
  const [{ filename }] = JSON.parse(result.stdout)
  return join(destinationDir, filename)
}

function installTarball(tarballPath, prefixDir, cacheDir) {
  const result = spawnSync('npm', [
    'install', '--global',
    '--prefix', prefixDir,
    '--cache', cacheDir,
    '--no-audit', '--no-fund', '--ignore-scripts',
    tarballPath,
  ], {
    encoding: 'utf8',
    timeout: 120_000,
  })
  if (result.status !== 0) {
    throw new Error(`npm install failed (status ${result.status}): ${result.stderr}`)
  }
  return join(prefixDir, 'bin', 'agent-loop')
}

function straceAvailable() {
  const result = spawnSync('/usr/bin/strace', ['-V'], { encoding: 'utf8' })
  return result.error === undefined && result.status === 0
}

function runInstalledCli(cliPath, args, { env, cwd, traceLogPath }) {
  return spawnSync('/usr/bin/strace', [
    '-f', '-s', '65536', '-e', 'trace=execve',
    '-P', '/usr/bin/git',
    '-o', traceLogPath,
    '--', cliPath, ...args,
  ], { encoding: 'utf8', env, cwd, timeout: 60_000 })
}

function inspectGitTrace(traceLogPath) {
  const lines = readFileSync(traceLogPath, 'utf8')
    .split('\n')
    .filter((line) => line.includes('execve("/usr/bin/git",'))
  assert.ok(lines.length > 0, 'expected at least one traced Git invocation')
  const tokenPattern = new RegExp(`"(?:${NETWORK_GIT_TOKENS.join('|')})"`, 'u')
  for (const line of lines) {
    assert.doesNotMatch(line, tokenPattern, 'Git invoked a forbidden or network-capable subcommand')
    assert.doesNotMatch(line, NETWORK_TARGET, 'Git invocation contained a network target')
  }
  return lines.length
}

function isDisjoint(pathA, pathB) {
  const relation = relative(pathA, pathB)
  const contains = relation === ''
    || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  const relationBack = relative(pathB, pathA)
  const containsBack = relationBack === ''
    || (!relationBack.startsWith(`..${sep}`) && relationBack !== '..' && !isAbsolute(relationBack))
  return !contains && !containsBack
}

function writeFakeHermes(executable) {
  writeFileSync(executable, `#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('fake-hermes 1.0.0\\n')
  process.exit(0)
}
const usagePath = args[args.indexOf('--usage-file') + 1]
writeFileSync('src/add.mjs', readFileSync('src/add.mjs', 'utf8').replace('a - b', 'a + b'))
const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false']
execFileSync('/usr/bin/git', [...gitOptions, 'add', '-A'], { stdio: 'ignore' })
execFileSync('/usr/bin/git', [...gitOptions, '-c', 'user.name=Maker', '-c', 'user.email=maker@example.invalid', 'commit', '--quiet', '-m', 'fix: repair addition'], { stdio: 'ignore' })
writeFileSync(usagePath, JSON.stringify({ model: 'fake-model', provider: 'fake-provider', api_calls: 1, total_tokens: 42, estimated_cost_usd: 0.01, completed: true, failed: false }))
process.stdout.write('Maker completed and committed the repair.\\n')
`)
  chmodSync(executable, 0o755)
}

function createTargetFixture(directory) {
  const repositoryPath = join(directory, 'repository')
  const binPath = join(directory, 'bin')
  mkdirSync(join(repositoryPath, 'src'), { recursive: true })
  mkdirSync(join(repositoryPath, 'test'), { recursive: true })
  mkdirSync(join(repositoryPath, '.agent-loop'), { recursive: true })
  mkdirSync(binPath, { recursive: true })

  writeFileSync(join(repositoryPath, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n')
  writeFileSync(join(repositoryPath, 'test', 'add.test.mjs'), `
import assert from 'node:assert/strict'
import test from 'node:test'
import { add } from '../src/add.mjs'
test('adds', () => { assert.equal(add(2, 3), 5) })
`)
  writeFileSync(join(repositoryPath, '.agent-loop', 'config.json'), JSON.stringify({
    schemaVersion: 1,
    pipeline: 'bug-fix',
    test: { executable: process.execPath, args: ['--test', 'test/add.test.mjs'] },
    allowedPaths: ['src/add.mjs'],
  }))

  git(repositoryPath, 'init', '--quiet')
  git(repositoryPath, 'add', '.')
  git(repositoryPath, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture')

  writeFakeHermes(join(binPath, 'hermes'))

  const workItemPath = join(directory, 'work-item.md')
  writeFileSync(workItemPath, '---\npipeline: bug-fix\n---\nFix src/add.mjs so the existing test passes.\n')

  return { repositoryPath, binPath, workItemPath }
}

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-package-install-test-'))
  return Promise.resolve()
    .then(() => run(directory))
    .finally(() => rmSync(directory, { recursive: true, force: true }))
}

function listInstalledModules(directory) {
  const modules = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) modules.push(...listInstalledModules(entryPath))
    else if (entry.isFile() && entry.name.endsWith('.mjs')) modules.push(entryPath)
  }
  return modules.sort()
}

let toolsDirectory
let cliPath
let installedPackageDirectory

before(() => {
  toolsDirectory = mkdtempSync(join(tmpdir(), 'agent-loop-package-install-tools-'))
  const packDestination = join(toolsDirectory, 'pack')
  const prefixDirectory = join(toolsDirectory, 'prefix')
  const cacheDirectory = join(toolsDirectory, 'cache')
  mkdirSync(packDestination, { recursive: true })
  mkdirSync(prefixDirectory, { recursive: true })
  mkdirSync(cacheDirectory, { recursive: true })

  const tarballPath = packTarball(packDestination)
  cliPath = installTarball(tarballPath, prefixDirectory, cacheDirectory)
  installedPackageDirectory = join(prefixDirectory, 'lib', 'node_modules', 'agent-loop-core')
})

after(() => {
  rmSync(toolsDirectory, { recursive: true, force: true })
})

test('the installed package ships no reference to a network Git subcommand in any shipped module', () => {
  const shippedModules = listInstalledModules(installedPackageDirectory)
  assert.ok(shippedModules.length > 0)
  for (const modulePath of shippedModules) {
    const content = readFileSync(modulePath, 'utf8')
    for (const token of NETWORK_GIT_TOKENS) {
      assert.doesNotMatch(
        content,
        new RegExp(`['"\\x60]${token}['"\\x60]`, 'u'),
        `${relative(installedPackageDirectory, modulePath)} must not reference Git token "${token}"`,
      )
    }
  }
})

test('installed agent-loop doctor --json reports a healthy disposable target from outside the package', async () => {
  await withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath } = createTargetFixture(directory)
    const stateRoot = join(directory, 'state')
    const env = {
      HOME: directory,
      PATH: `${binPath}:${dirname(process.execPath)}:/usr/bin:/bin`,
      LANG: 'C.UTF-8',
      AWS_SECRET_ACCESS_KEY: SECRET_MARKERS[1],
    }

    const result = spawnSync(cliPath, [
      'doctor',
      '--repo', repositoryPath,
      '--state-root', stateRoot,
      '--json',
    ], { encoding: 'utf8', env, timeout: 30_000 })

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.healthy, true)
    assert.equal(report.checks.find(({ id }) => id === 'state.disjoint')?.status, 'pass')
    assert.equal(report.checks.find(({ id }) => id === 'state.writable')?.status, 'pass')
    assert.equal(existsSync(stateRoot), false, 'doctor must remove its disposable writability probe')
    for (const marker of SECRET_MARKERS) {
      assert.doesNotMatch(result.stdout, new RegExp(marker))
      assert.doesNotMatch(result.stderr, new RegExp(marker))
    }
  })
})

test('installed agent-loop run repairs a disposable external repository, keeps the target untouched, keeps state external, and never invokes a network Git operation', async () => {
  await withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath, workItemPath } = createTargetFixture(directory)
    const stateRoot = join(directory, 'state')
    const configPath = join(repositoryPath, '.agent-loop', 'config.json')
    const configBefore = readFileSync(configPath, 'utf8')
    const sourceBefore = readFileSync(join(repositoryPath, 'src', 'add.mjs'), 'utf8')
    const headBefore = git(repositoryPath, 'rev-parse', 'HEAD')
    const remotesBefore = git(repositoryPath, 'remote')
    const baseTest = spawnSync(process.execPath, ['--test', 'test/add.test.mjs'], {
      cwd: repositoryPath,
      encoding: 'utf8',
      env: {
        HOME: directory,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        LANG: 'C.UTF-8',
      },
      timeout: 30_000,
    })
    assert.equal(baseTest.status, 1, 'the captured base commit must reproduce the real failing test')

    const env = {
      HOME: directory,
      PATH: `${binPath}:${dirname(process.execPath)}:/usr/bin:/bin`,
      LANG: 'C.UTF-8',
      AWS_SECRET_ACCESS_KEY: SECRET_MARKERS[1],
      AGENT_LOOP_TEST_PARENT_SECRET: SECRET_MARKERS[0],
    }
    const traceLogPath = join(directory, 'git-execve-trace.log')
    assert.equal(straceAvailable(), true, 'strace is required to prove no network Git operation occurs')

    const result = runInstalledCli(cliPath, [
      'run',
      '--repo', repositoryPath,
      '--work-item', workItemPath,
      '--state-root', stateRoot,
      '--acknowledge-unsandboxed-credential-access',
      '--json',
    ], { env, cwd: directory, traceLogPath })

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision, 'pass')
    assert.match(report.baseCommit, /^[a-f0-9]{40}$/)
    assert.match(report.makerCommit, /^[a-f0-9]{40}$/)
    assert.equal(report.verifierCommit, report.makerCommit)

    // Target checkout: HEAD, status, config, and the originally defective source are unchanged.
    assert.equal(git(repositoryPath, 'rev-parse', 'HEAD'), headBefore)
    assert.equal(git(repositoryPath, 'status', '--porcelain'), '')
    assert.equal(readFileSync(configPath, 'utf8'), configBefore)
    assert.equal(readFileSync(join(repositoryPath, 'src', 'add.mjs'), 'utf8'), sourceBefore)
    assert.equal(git(repositoryPath, 'remote'), remotesBefore)
    assert.equal(remotesBefore, '')

    // State, evidence, and worktrees live entirely outside the target repository.
    assert.equal(report.stateRoot, stateRoot)
    assert.equal(isDisjoint(repositoryPath, stateRoot), true)
    assert.equal(existsSync(report.evidencePath), true)
    assert.equal(isDisjoint(repositoryPath, report.evidencePath), true)
    const makerWorktree = join(stateRoot, 'worktrees', report.runId, 'maker')
    const verifierWorktree = join(stateRoot, 'worktrees', report.runId, 'verifier')
    assert.equal(existsSync(makerWorktree), true)
    assert.equal(existsSync(verifierWorktree), true)
    assert.equal(isDisjoint(repositoryPath, makerWorktree), true)
    assert.equal(isDisjoint(repositoryPath, verifierWorktree), true)

    const makerParents = git(makerWorktree, 'rev-list', '--parents', '-n', '1', report.makerCommit).split(/\s+/u)
    assert.deepEqual(makerParents, [report.makerCommit, report.baseCommit])
    assert.equal(git(makerWorktree, 'rev-list', '--count', `${report.baseCommit}..${report.makerCommit}`), '1')
    assert.deepEqual(
      git(makerWorktree, 'diff', '--name-only', `${report.baseCommit}..${report.makerCommit}`).split('\n'),
      ['src/add.mjs'],
    )
    assert.equal(git(makerWorktree, 'status', '--porcelain'), '')
    assert.equal(git(verifierWorktree, 'rev-parse', 'HEAD'), report.makerCommit)
    const verifierTest = spawnSync(process.execPath, ['--test', 'test/add.test.mjs'], {
      cwd: verifierWorktree,
      encoding: 'utf8',
      env: {
        HOME: directory,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        LANG: 'C.UTF-8',
      },
      timeout: 30_000,
    })
    assert.equal(verifierTest.status, 0, 'the exact verifier commit must independently pass its bounded test')
    assert.equal(git(verifierWorktree, 'status', '--porcelain'), '')

    // Evidence digest matches the recorded evidence file exactly.
    const evidenceContent = readFileSync(report.evidencePath, 'utf8')
    assert.equal(createHash('sha256').update(evidenceContent).digest('hex'), report.evidenceDigest)

    const ledgerPath = join(stateRoot, 'logs', 'dispatch.jsonl')
    const ledgerContent = readFileSync(ledgerPath, 'utf8')

    // No raw provider output, error text, credentials, or arbitrary parent-environment secrets leak.
    const haystacks = [result.stdout, result.stderr, evidenceContent, ledgerContent]
    for (const marker of SECRET_MARKERS) {
      for (const haystack of haystacks) assert.doesNotMatch(haystack, new RegExp(marker))
    }
    for (const haystack of haystacks) {
      assert.doesNotMatch(haystack, /Maker completed and committed the repair/)
    }

    // Inspect every Git execve performed by the installed CLI and fail closed without tracing.
    assert.ok(inspectGitTrace(traceLogPath) > 0)
  })
})

test('the productized demo independently tests the verifier commit and emits only a normalized run report', () => {
  const demoPath = join(ROOT, 'scripts', 'demo-productized-runtime.mjs')
  const source = readFileSync(demoPath, 'utf8')

  assert.doesNotMatch(source, /baseTestFailed:\s*true/u)
  assert.doesNotMatch(source, /run:\s*report[,\n]/u)
  assert.match(source, /function normalizeRunReport\(/u)
  assert.match(source, /verifierTestPassed:/u)
})

test('the productized demo fails closed without explicit unsandboxed credential acknowledgment', () => {
  const demoPath = join(ROOT, 'scripts', 'demo-productized-runtime.mjs')
  const result = spawnSync(process.execPath, [demoPath, '--keep'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      LANG: 'C.UTF-8',
    },
    timeout: 30_000,
  })

  assert.equal(result.status, 2)
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    error: 'ACKNOWLEDGMENT_REQUIRED',
  })
  assert.equal(result.stderr, '')
})
