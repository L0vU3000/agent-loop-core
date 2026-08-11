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
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { runAgentLoopRun } from '../src/cli/run.mjs'
import { runCommand } from '../src/runtime/command.mjs'
import { canonicalMakerRuntime } from './helpers.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = resolve(ROOT, 'bin', 'agent-loop.mjs')

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-run-cli-test-'))
  return Promise.resolve()
    .then(() => run(directory))
    .finally(() => rmSync(directory, { recursive: true, force: true }))
}

function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', [
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
  }).trim()
}

function writeFakeHermes(executable, { repair = true, mutateOriginalPath } = {}) {
  const nodePath = process.execPath
  writeFileSync(executable, `#!${nodePath}
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('fake-hermes 1.0.0\\n')
  process.exit(0)
}
const usagePath = args[args.indexOf('--usage-file') + 1]
${repair ? "writeFileSync('src/add.mjs', readFileSync('src/add.mjs', 'utf8').replace('a - b', 'a + b'))" : ''}
const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false']
execFileSync('/usr/bin/git', [...gitOptions, 'add', '-A'], { stdio: 'ignore' })
execFileSync('/usr/bin/git', [...gitOptions, '-c', 'user.name=Maker', '-c', 'user.email=maker@example.invalid', 'commit', '--quiet', '-m', 'fix: repair addition'], { stdio: 'ignore' })
${mutateOriginalPath === undefined ? '' : `writeFileSync(${JSON.stringify(mutateOriginalPath)}, 'unauthorized mutation\\n')`}
writeFileSync(usagePath, JSON.stringify({ model: 'claude-sonnet-5', provider: 'anthropic', api_calls: 1, total_tokens: 42, estimated_cost_usd: 0.01, completed: true, failed: false }))
process.stdout.write('Maker completed and committed the repair.\\n')
`)
  chmodSync(executable, 0o755)
}

function writeNoCommitHermes(executable) {
  const nodePath = process.execPath
  writeFileSync(executable, `#!${nodePath}
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('fake-hermes 1.0.0\\n')
  process.exit(0)
}
const usagePath = args[args.indexOf('--usage-file') + 1]
writeFileSync(usagePath, JSON.stringify({ model: 'claude-sonnet-5', provider: 'anthropic', api_calls: 1, total_tokens: 42, estimated_cost_usd: 0.01, completed: true, failed: false }))
process.stdout.write('Maker made no commit.\\n')
`)
  chmodSync(executable, 0o755)
}

function createFixture(directory, { repairs = true, mutateOriginal = false } = {}) {
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
    test: { executable: process.execPath, args: ['--test'] },
    allowedPaths: ['src/add.mjs'],
    maker: {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      timeoutMs: 300000,
    },
  }))

  git(repositoryPath, 'init', '--quiet')
  git(repositoryPath, 'add', '.')
  git(repositoryPath, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture')

  writeFakeHermes(join(binPath, 'hermes'), {
    repair: repairs,
    mutateOriginalPath: mutateOriginal ? join(repositoryPath, 'unauthorized.txt') : undefined,
  })

  const workItemPath = join(directory, 'work-item.md')
  writeFileSync(workItemPath, '---\npipeline: bug-fix\n---\nFix src/add.mjs so the existing test passes.\n')

  return { repositoryPath, binPath, workItemPath }
}

function runCliProcess(args, { cwd, env }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd ?? ROOT,
    encoding: 'utf8',
    env,
  })
}

function baseEnv(directory, binPath) {
  return {
    HOME: directory,
    PATH: `${binPath}:${dirname(process.execPath)}:/usr/bin:/bin`,
    LANG: 'C.UTF-8',
  }
}

function withMutatedEnv(overrides, run) {
  const previous = {}
  for (const key of Object.keys(overrides)) previous[key] = process.env[key]
  Object.assign(process.env, overrides)
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key]
        else process.env[key] = previous[key]
      }
    })
}

test('acknowledgment flag is mandatory and rejected before any doctor or claim work happens', async () => {
  await withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath, workItemPath } = createFixture(directory)
    const stateRoot = join(directory, 'state')

    const result = runCliProcess([
      'run',
      '--repo', repositoryPath,
      '--work-item', workItemPath,
      '--state-root', stateRoot,
    ], { env: baseEnv(directory, binPath) })

    assert.equal(result.status, 2)
    assert.match(result.stderr, /--acknowledge-unsandboxed-credential-access is required for run/)
    assert.equal(existsSync(stateRoot), false)
  })
})

test('relative --state-root is rejected for run', async () => {
  await withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath, workItemPath } = createFixture(directory)

    const result = runCliProcess([
      'run',
      '--repo', repositoryPath,
      '--work-item', workItemPath,
      '--state-root', 'relative/state',
      '--acknowledge-unsandboxed-credential-access',
    ], { env: baseEnv(directory, binPath) })

    assert.equal(result.status, 2)
    assert.match(result.stderr, /option --state-root must be an absolute path/)
  })
})

test('run orchestration rejects missing acknowledgment before doctor or claim work', async () => {
  let doctorCalled = false
  let claimCalled = false
  const report = await runAgentLoopRun(
    { repo: '/does/not/matter', workItem: '/does/not/matter.md' },
    {
      runDoctorFn: () => {
        doctorCalled = true
        return { schemaVersion: 1, healthy: true, checks: [] }
      },
      claimWorkItemFn: () => {
        claimCalled = true
        throw new Error('claim must not be reached')
      },
    },
  )

  assert.equal(doctorCalled, false)
  assert.equal(claimCalled, false)
  assert.equal(report.exitCode, 2)
  assert.deepEqual(report.json, { schemaVersion: 1, error: 'ACKNOWLEDGMENT_REQUIRED' })
})

test('doctor gates execute before any claim is made', async () => {
  let claimCalled = false
  const report = await runAgentLoopRun(
    { repo: '/does/not/matter', workItem: '/does/not/matter.md', acknowledgeUnsandboxedCredentialAccess: true },
    {
      runDoctorFn: () => ({ schemaVersion: 1, healthy: false, checks: [] }),
      claimWorkItemFn: () => {
        claimCalled = true
        throw new Error('claim must not be reached')
      },
    },
  )

  assert.equal(claimCalled, false)
  assert.equal(report.exitCode, 2)
  assert.deepEqual(report.json, { schemaVersion: 1, error: 'DOCTOR_UNHEALTHY' })
})

function fakeStagePipeline(overrides = {}) {
  const state = Object.freeze({
    repositoryRoot: '/fixture/repo',
    gitCommonDirectory: '/fixture/repo.git',
    stateRoot: '/fixture/state',
    paths: Object.freeze({}),
  })
  const claim = Object.freeze({ workItemDigest: 'd'.repeat(64), content: 'work item body' })
  const run = Object.freeze({
    schemaVersion: 1,
    runId: 'run-fixture',
    baseCommit: 'a'.repeat(40),
    configDigest: 'c'.repeat(64),
    workItemDigest: claim.workItemDigest,
  })
  const maker = Object.freeze({
    runId: run.runId,
    artifactId: 'e'.repeat(64),
    commit: 'b'.repeat(40),
    parentCommit: run.baseCommit,
    changedPaths: Object.freeze(['src/add.mjs']),
  })
  const makerRuntime = canonicalMakerRuntime()
  const resolveCalls = []
  const defaults = {
    runDoctorFn: () => ({ schemaVersion: 1, healthy: true, checks: [] }),
    deriveRepositoryStateFn: () => state,
    loadConfigFn: () => fakeConfig(),
    resolveBaseCommitFn: () => run.baseCommit,
    assertMakerBranchAvailableFn: () => `agent-loop/${run.runId}-maker`,
    claimWorkItemFn: () => claim,
    createRunIdentityFn: () => run,
    findExecutableFn: () => '/trusted/bin/hermes',
    createHermesMakerFn: () => async () => canonicalMakerRuntime(),
    runGitTransactionFn: async () => {
      throw new Error('stop after maker construction')
    },
    recordEvidenceFn: () => {},
    resolveWorkItemFn: (call) => { resolveCalls.push(call) },
    ...overrides,
  }
  return { state, claim, run, maker, makerRuntime, resolveCalls, defaults }
}

const CANONICAL_MAKER_CONFIG = Object.freeze({
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  timeoutMs: 300_000,
})

function fakeConfig(overrides = {}) {
  return Object.freeze({
    schemaVersion: 1,
    pipeline: 'bug-fix',
    test: Object.freeze({ executable: process.execPath, args: Object.freeze(['--test']) }),
    allowedPaths: Object.freeze(['src/add.mjs']),
    maker: { ...CANONICAL_MAKER_CONFIG },
    ...overrides,
  })
}

test('passes exactly config.maker provider, model, and timeoutMs into createHermesMakerFn', async () => {
  let makerOptions
  const config = fakeConfig()
  const { defaults } = fakeStagePipeline({
    loadConfigFn: () => config,
    createHermesMakerFn: (options) => {
      makerOptions = options
      return async () => {}
    },
    runGitTransactionFn: async () => {
      throw new Error('stop after maker construction')
    },
  })

  await runAgentLoopRun(
    { repo: '/x', workItem: '/x.md', acknowledgeUnsandboxedCredentialAccess: true },
    defaults,
  )

  assert.equal(makerOptions.executable, '/trusted/bin/hermes')
  assert.equal(makerOptions.provider, config.maker.provider)
  assert.equal(makerOptions.model, config.maker.model)
  assert.equal(makerOptions.timeoutMs, config.maker.timeoutMs)
  assert.equal('maxTurns' in makerOptions, false)
  assert.equal(makerOptions.acknowledgeUnsandboxedCredentialAccess, true)
})

test('pins the maker to a trusted Hermes executable outside the target and Git metadata roots', async () => {
  let lookup
  let makerOptions
  const env = { HOME: '/fixture/home', PATH: '/fixture/repo/bin:/trusted/bin', LANG: 'C.UTF-8' }
  const { defaults } = fakeStagePipeline({
    findExecutableFn: (name, receivedEnv, excludedRoots) => {
      lookup = { name, receivedEnv, excludedRoots }
      return '/trusted/bin/hermes'
    },
    createHermesMakerFn: (options) => {
      makerOptions = options
      return async () => {}
    },
    runGitTransactionFn: async () => {
      throw new Error('stop after maker construction')
    },
  })

  await runAgentLoopRun(
    { repo: '/x', workItem: '/x.md', acknowledgeUnsandboxedCredentialAccess: true },
    { ...defaults, env },
  )

  assert.deepEqual(lookup, {
    name: 'hermes',
    receivedEnv: env,
    excludedRoots: ['/fixture/repo', '/fixture/repo.git'],
  })
  assert.equal(makerOptions.executable, '/trusted/bin/hermes')
})

test('records a pass decision with normalized JSON and exit code zero', async () => {
  const { run, maker, makerRuntime, resolveCalls, defaults } = fakeStagePipeline({
    runGitTransactionFn: async () => ({
      maker,
      makerRuntime,
      verifier: { runId: run.runId, artifactId: maker.artifactId, commit: maker.commit, verdict: 'pass', score: 1, exitCode: 0 },
      objectiveGate: {
        runId: run.runId,
        artifactId: maker.artifactId,
        commit: maker.commit,
        checked: true,
        passed: true,
        checks: { exactHead: true, clean: true, originalHead: true, originalClean: true, tests: true },
      },
    }),
    recordEvidenceFn: ({ decision }) => ({
      record: {},
      evidenceDigest: 'f'.repeat(64),
      evidencePath: '/fixture/state/evidence/run-fixture.json',
      ledgerPath: '/fixture/state/logs/dispatch.jsonl',
      decision,
    }),
  })

  const report = await runAgentLoopRun({ repo: '/x', workItem: '/x.md', acknowledgeUnsandboxedCredentialAccess: true }, defaults)

  assert.equal(report.exitCode, 0)
  assert.deepEqual(report.json, {
    schemaVersion: 1,
    runId: run.runId,
    decision: 'pass',
    baseCommit: run.baseCommit,
    makerCommit: maker.commit,
    verifierCommit: maker.commit,
    evidencePath: '/fixture/state/evidence/run-fixture.json',
    evidenceDigest: 'f'.repeat(64),
    stateRoot: '/fixture/state',
  })
  assert.deepEqual(resolveCalls, [{ paths: {}, workItemDigest: 'd'.repeat(64), outcome: 'pass' }])
})

test('records a fail decision with exit code one when the objective gate does not pass', async () => {
  const { run, maker, makerRuntime, resolveCalls, defaults } = fakeStagePipeline({
    runGitTransactionFn: async () => ({
      maker,
      makerRuntime,
      verifier: { runId: run.runId, artifactId: maker.artifactId, commit: maker.commit, verdict: 'fail', score: 0, exitCode: 1 },
      objectiveGate: {
        runId: run.runId,
        artifactId: maker.artifactId,
        commit: maker.commit,
        checked: true,
        passed: false,
        checks: { exactHead: true, clean: true, originalHead: true, originalClean: true, tests: false },
      },
    }),
    recordEvidenceFn: ({ decision }) => ({
      record: {},
      evidenceDigest: 'f'.repeat(64),
      evidencePath: '/fixture/state/evidence/run-fixture.json',
      ledgerPath: '/fixture/state/logs/dispatch.jsonl',
      decision,
    }),
  })

  const report = await runAgentLoopRun({ repo: '/x', workItem: '/x.md', acknowledgeUnsandboxedCredentialAccess: true }, defaults)

  assert.equal(report.exitCode, 1)
  assert.equal(report.json.decision, 'fail')
  assert.deepEqual(resolveCalls, [{ paths: {}, workItemDigest: 'd'.repeat(64), outcome: 'fail' }])
})

test('an unexpected Git transaction failure exits three with stable redacted output after best-effort claim resolution', async () => {
  const { resolveCalls, defaults } = fakeStagePipeline({
    runGitTransactionFn: async () => {
      throw new Error('Authorization: Bearer secret-value raw failure')
    },
  })

  const report = await runAgentLoopRun({ repo: '/x', workItem: '/x.md', acknowledgeUnsandboxedCredentialAccess: true }, defaults)

  assert.equal(report.exitCode, 3)
  assert.deepEqual(report.json, { schemaVersion: 1, error: 'GIT_TRANSACTION_FAILED' })
  assert.doesNotMatch(JSON.stringify(report), /Authorization|Bearer|secret-value/)
  assert.deepEqual(resolveCalls, [{ paths: {}, workItemDigest: 'd'.repeat(64), outcome: 'fail' }])
})

test('a duplicate claim on the same work item fails closed with exit code two', async () => {
  const { defaults } = fakeStagePipeline({
    claimWorkItemFn: () => {
      throw new Error('WORK_ITEM_ALREADY_CLAIMED: deadbeef')
    },
  })

  const report = await runAgentLoopRun({ repo: '/x', workItem: '/x.md', acknowledgeUnsandboxedCredentialAccess: true }, defaults)

  assert.equal(report.exitCode, 2)
  assert.deepEqual(report.json, { schemaVersion: 1, error: 'WORK_ITEM_ALREADY_CLAIMED' })
})

test('a pre-existing maker branch is rejected before any claim is made', async () => {
  let claimCalled = false
  const { defaults } = fakeStagePipeline({
    assertMakerBranchAvailableFn: () => {
      throw new Error('MAKER_BRANCH_ALREADY_EXISTS')
    },
    claimWorkItemFn: () => {
      claimCalled = true
      throw new Error('claim must not be reached')
    },
  })

  const report = await runAgentLoopRun({ repo: '/x', workItem: '/x.md', acknowledgeUnsandboxedCredentialAccess: true }, defaults)

  assert.equal(claimCalled, false)
  assert.equal(report.exitCode, 2)
  assert.deepEqual(report.json, { schemaVersion: 1, error: 'MAKER_BRANCH_UNAVAILABLE' })
})

test('a real disposable fake-Hermes transaction repairs an external repository, records one pass, keeps the target untouched, uses no remote Git command, and fails closed on rerun', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryPath, binPath, workItemPath } = createFixture(directory, { repairs: true })
    const stateRoot = join(directory, 'state')
    const configPath = join(repositoryPath, '.agent-loop', 'config.json')
    const configBefore = readFileSync(configPath, 'utf8')
    const headBefore = git(repositoryPath, 'rev-parse', 'HEAD')
    const gitVerbs = []
    const commandRunner = (executable, args, options) => {
      if (executable === '/usr/bin/git') {
        const repositoryIndex = args.indexOf('-C')
        if (repositoryIndex !== -1) gitVerbs.push(args[repositoryIndex + 2])
      }
      return runCommand(executable, args, options)
    }

    await withMutatedEnv(baseEnv(directory, binPath), async () => {
      const report = await runAgentLoopRun(
        {
          repo: repositoryPath,
          workItem: workItemPath,
          stateRoot,
          acknowledgeUnsandboxedCredentialAccess: true,
        },
        { commandRunner },
      )

      assert.equal(report.exitCode, 0, JSON.stringify(report))
      assert.equal(report.json.decision, 'pass')
      assert.match(report.json.baseCommit, /^[a-f0-9]{40}$/)
      assert.match(report.json.makerCommit, /^[a-f0-9]{40}$/)
      assert.equal(report.json.verifierCommit, report.json.makerCommit)
      assert.equal(report.json.stateRoot, stateRoot)
      assert.equal(existsSync(report.json.evidencePath), true)
      const evidenceOnDisk = readFileSync(report.json.evidencePath, 'utf8')
      const parsedEvidence = JSON.parse(evidenceOnDisk)
      assert.equal(createHash('sha256').update(evidenceOnDisk).digest('hex'), report.json.evidenceDigest)
      assert.doesNotMatch(evidenceOnDisk, /Maker completed and committed the repair/)
      assert.equal(parsedEvidence.schemaVersion, 2)
      assert.equal(parsedEvidence.makerRuntime.runtime, 'hermes')
      assert.equal(parsedEvidence.makerRuntime.exitCode, 0)
      assert.equal(parsedEvidence.makerRuntime.usage.provider, 'anthropic')
      assert.equal(parsedEvidence.makerRuntime.usage.model, 'claude-sonnet-5')
      assert.equal(parsedEvidence.makerRuntime.usage.completed, true)
      assert.equal(parsedEvidence.makerRuntime.usage.failed, false)
      assert.equal(parsedEvidence.decision, 'pass')
      assert.equal(parsedEvidence.makerRuntime.stdout, undefined)
      assert.equal(parsedEvidence.makerRuntime.stderr, undefined)
      assert.equal(parsedEvidence.makerRuntime.usage.rawOutput, undefined)

      assert.equal(readFileSync(configPath, 'utf8'), configBefore)
      assert.equal(git(repositoryPath, 'rev-parse', 'HEAD'), headBefore)
      assert.equal(git(repositoryPath, 'status', '--porcelain'), '')
      assert.equal(readFileSync(join(repositoryPath, 'src', 'add.mjs'), 'utf8'), 'export function add(a, b) { return a - b }\n')

      for (const forbidden of ['push', 'pull', 'fetch', 'merge', 'clone']) {
        assert.equal(gitVerbs.includes(forbidden), false)
      }

      const doneDirectory = join(stateRoot, 'inbox', 'done')
      assert.equal(readdirSync(doneDirectory).length, 1)
      const pendingDirectory = join(stateRoot, 'inbox', 'pending')
      assert.equal(existsSync(pendingDirectory) ? readdirSync(pendingDirectory).length : 0, 0)
      const inProgressDirectory = join(stateRoot, 'inbox', 'in-progress')
      assert.equal(existsSync(inProgressDirectory) ? readdirSync(inProgressDirectory).length : 0, 0)

      const rerun = await runAgentLoopRun(
        {
          repo: repositoryPath,
          workItem: workItemPath,
          stateRoot,
          acknowledgeUnsandboxedCredentialAccess: true,
        },
      )

      assert.equal(rerun.exitCode, 2, JSON.stringify(rerun))
      assert.deepEqual(rerun.json, { schemaVersion: 1, error: 'WORK_ITEM_ALREADY_CLAIMED' })
      assert.equal(readdirSync(doneDirectory).length, 1)
      const ledgerPath = join(stateRoot, 'logs', 'dispatch.jsonl')
      const ledgerLines = readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean)
      assert.equal(ledgerLines.length, 1)
    })
  })
})

test('a real transaction records exit one and fail evidence when an objective gate rejects the maker commit', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryPath, binPath, workItemPath } = createFixture(directory, {
      repairs: true,
      mutateOriginal: true,
    })
    const stateRoot = join(directory, 'state')

    const result = runCliProcess([
      'run',
      '--repo', repositoryPath,
      '--work-item', workItemPath,
      '--state-root', stateRoot,
      '--acknowledge-unsandboxed-credential-access',
      '--json',
    ], { env: baseEnv(directory, binPath) })

    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision, 'fail')
    assert.equal(existsSync(report.evidencePath), true)
    const evidence = readFileSync(report.evidencePath, 'utf8')
    assert.equal(JSON.parse(evidence).decision, 'fail')
    assert.doesNotMatch(evidence, /Maker completed and committed the repair/)
    assert.equal(readdirSync(join(stateRoot, 'inbox', 'failed')).length, 1)
    assert.equal(readFileSync(join(stateRoot, 'logs', 'dispatch.jsonl'), 'utf8').trim().split('\n').length, 1)
  })
})

test('a maker that never repairs the defect produces an internal-error exit code through the real CLI without leaking raw output', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryPath, binPath, workItemPath } = createFixture(directory, { repairs: true })
    writeNoCommitHermes(join(binPath, 'hermes'))
    const stateRoot = join(directory, 'state')
    const headBefore = git(repositoryPath, 'rev-parse', 'HEAD')

    const result = runCliProcess([
      'run',
      '--repo', repositoryPath,
      '--work-item', workItemPath,
      '--state-root', stateRoot,
      '--acknowledge-unsandboxed-credential-access',
      '--json',
    ], { env: baseEnv(directory, binPath) })

    assert.equal(result.status, 3, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.deepEqual(report, { schemaVersion: 1, error: 'GIT_TRANSACTION_FAILED' })
    assert.doesNotMatch(result.stdout, /Maker made no commit/)
    assert.equal(git(repositoryPath, 'rev-parse', 'HEAD'), headBefore)
    assert.equal(git(repositoryPath, 'status', '--porcelain'), '')
  })
})
