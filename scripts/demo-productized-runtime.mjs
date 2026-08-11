#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ACKNOWLEDGMENT = '--acknowledge-unsandboxed-credential-access'
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u
const DIGEST = /^[a-f0-9]{64}$/u
const RUN_REPORT_KEYS = Object.freeze([
  'baseCommit',
  'decision',
  'evidenceDigest',
  'evidencePath',
  'makerCommit',
  'runId',
  'schemaVersion',
  'stateRoot',
  'verifierCommit',
])
const NETWORK_GIT_TOKENS = Object.freeze([
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
])
const NETWORK_TARGET = /(?:https?|ssh|git):\/\/|git@/u

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function fail(code, exitCode) {
  emit({ schemaVersion: 1, error: code })
  process.exitCode = exitCode
}

function parseArguments(argv) {
  const supported = new Set(['--keep', ACKNOWLEDGMENT])
  for (const argument of argv) {
    if (!supported.has(argument)) return { error: 'INVALID_ARGUMENT' }
  }
  return {
    keep: argv.includes('--keep'),
    acknowledged: argv.includes(ACKNOWLEDGMENT)
      || process.env.AGENT_LOOP_ACKNOWLEDGE_UNSANDBOXED_CREDENTIAL_ACCESS === '1',
  }
}

function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', [
    '--no-optional-locks',
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false',
    '-c', 'commit.gpgSign=false',
    '-c', 'credential.helper=',
    '-c', 'protocol.file.allow=never',
    '-C', cwd,
    ...args,
  ], {
    encoding: 'utf8',
    env: {
      HOME: '/dev/null',
      PATH: '/usr/bin:/bin',
      LANG: 'C.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      XDG_CONFIG_HOME: '/dev/null',
    },
    timeout: 30_000,
  }).trim()
}

function run(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    timeout: options.timeout ?? 120_000,
    maxBuffer: 1024 * 1024,
    shell: false,
  })
}

function requireSuccess(result, code) {
  if (result.status !== 0 || result.error !== undefined || result.signal !== null) {
    throw new Error(code)
  }
  return result.stdout
}

function normalizeRunReport(report, stateRoot) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('RUN_REPORT_INVALID')
  }
  if (Object.keys(report).sort().join('\0') !== [...RUN_REPORT_KEYS].sort().join('\0')) {
    throw new Error('RUN_REPORT_INVALID')
  }
  if (
    report.schemaVersion !== 1
    || report.decision !== 'pass'
    || !RUN_ID.test(report.runId)
    || !COMMIT.test(report.baseCommit)
    || !COMMIT.test(report.makerCommit)
    || !COMMIT.test(report.verifierCommit)
    || !DIGEST.test(report.evidenceDigest)
    || report.stateRoot !== stateRoot
    || report.evidencePath !== join(stateRoot, 'evidence', `${report.runId}.json`)
  ) {
    throw new Error('RUN_REPORT_INVALID')
  }
  return Object.freeze({
    schemaVersion: 1,
    runId: report.runId,
    decision: 'pass',
    baseCommit: report.baseCommit,
    makerCommit: report.makerCommit,
    verifierCommit: report.verifierCommit,
    evidencePath: report.evidencePath,
    evidenceDigest: report.evidenceDigest,
    stateRoot,
  })
}

function normalizeDoctorReport(report) {
  const expectedIds = [
    'node.version',
    'git.executable',
    'git.repository',
    'git.head',
    'git.clean',
    'config.valid',
    'state.disjoint',
    'state.writable',
    'hermes.executable',
    'sandbox.deferred',
  ]
  if (
    report === null || typeof report !== 'object' || Array.isArray(report)
    || report.schemaVersion !== 1 || report.healthy !== true
    || !Array.isArray(report.checks) || report.checks.length !== expectedIds.length
  ) {
    throw new Error('DOCTOR_REPORT_INVALID')
  }
  const checks = report.checks.map((entry, index) => {
    const expectedStatus = entry?.id === 'sandbox.deferred' ? 'warning' : 'pass'
    if (entry?.id !== expectedIds[index] || entry?.status !== expectedStatus) {
      throw new Error('DOCTOR_REPORT_INVALID')
    }
    return Object.freeze({ id: expectedIds[index], status: expectedStatus })
  })
  return Object.freeze({ schemaVersion: 1, healthy: true, checks: Object.freeze(checks) })
}

function packageAndInstall(demoRoot) {
  const packDirectory = join(demoRoot, 'package')
  const prefixDirectory = join(demoRoot, 'tools')
  const cacheDirectory = join(demoRoot, 'npm-cache')
  mkdirSync(packDirectory, { recursive: true })
  mkdirSync(prefixDirectory, { recursive: true })
  mkdirSync(cacheDirectory, { recursive: true })

  const packed = run('npm', ['pack', '--json', '--pack-destination', packDirectory], {
    cwd: ROOT,
    timeout: 60_000,
  })
  const packJson = JSON.parse(requireSuccess(packed, 'PACKAGE_PACK_FAILED'))
  if (!Array.isArray(packJson) || packJson.length !== 1 || typeof packJson[0]?.filename !== 'string') {
    throw new Error('PACKAGE_PACK_RESULT_INVALID')
  }
  const tarballPath = join(packDirectory, packJson[0].filename)

  const installed = run('npm', [
    'install', '--global',
    '--prefix', prefixDirectory,
    '--cache', cacheDirectory,
    '--no-audit', '--no-fund', '--ignore-scripts',
    tarballPath,
  ], { timeout: 120_000 })
  requireSuccess(installed, 'PACKAGE_INSTALL_FAILED')
  return {
    cliPath: join(prefixDirectory, 'bin', 'agent-loop'),
    prefixDirectory,
    tarballPath,
  }
}

function createTarget(demoRoot) {
  const repositoryPath = join(demoRoot, 'target-repository')
  mkdirSync(join(repositoryPath, 'src'), { recursive: true })
  mkdirSync(join(repositoryPath, 'test'), { recursive: true })
  mkdirSync(join(repositoryPath, '.agent-loop'), { recursive: true })

  writeFileSync(join(repositoryPath, 'src', 'add.mjs'), 'export function add(a, b) { return a - b }\n')
  writeFileSync(join(repositoryPath, 'test', 'add.test.mjs'), [
    "import assert from 'node:assert/strict'",
    "import test from 'node:test'",
    "import { add } from '../src/add.mjs'",
    "test('adds two numbers', () => { assert.equal(add(2, 3), 5) })",
    '',
  ].join('\n'))
  const configPath = join(repositoryPath, '.agent-loop', 'config.json')
  writeFileSync(configPath, `${JSON.stringify({
    schemaVersion: 1,
    pipeline: 'bug-fix',
    test: { executable: process.execPath, args: ['--test', 'test/add.test.mjs'] },
    allowedPaths: ['src/add.mjs'],
    maker: {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      timeoutMs: 300_000,
    },
  }, null, 2)}\n`)

  git(repositoryPath, 'init', '--quiet')
  git(repositoryPath, 'add', '.')
  git(
    repositoryPath,
    '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '-m', 'fixture: reproduce addition defect',
  )

  const workItemPath = join(demoRoot, 'work-item.md')
  writeFileSync(
    workItemPath,
    '---\npipeline: bug-fix\n---\nFix src/add.mjs so the existing bounded test passes.\n',
  )
  return { repositoryPath, configPath, workItemPath }
}

function safeEnvironment() {
  const env = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? 'C.UTF-8',
  }
  for (const key of ['HERMES_HOME', 'LC_ALL', 'TMPDIR']) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return env
}

function pathsDisjoint(left, right) {
  const canonicalLeft = realpathSync(left)
  const canonicalRight = realpathSync(right)
  const contains = (parent, candidate) => {
    const relation = relative(parent, candidate)
    return relation === '' || (
      relation !== '..'
      && !relation.startsWith(`..${sep}`)
      && !isAbsolute(relation)
    )
  }
  return !contains(canonicalLeft, canonicalRight) && !contains(canonicalRight, canonicalLeft)
}

function inspectGitTrace(tracePath) {
  const lines = readFileSync(tracePath, 'utf8')
    .split('\n')
    .filter((line) => line.includes('execve("/usr/bin/git",'))
  if (lines.length === 0) throw new Error('GIT_TRACE_EMPTY')

  const tokenPattern = new RegExp(`"(?:${NETWORK_GIT_TOKENS.join('|')})"`, 'u')
  const forbiddenInvocationCount = lines.filter((line) => tokenPattern.test(line)).length
  const networkTargetCount = lines.filter((line) => NETWORK_TARGET.test(line)).length
  return Object.freeze({
    tracedGitInvocationCount: lines.length,
    forbiddenGitInvocationCount: forbiddenInvocationCount,
    networkGitTargetCount: networkTargetCount,
  })
}

function traceInstalledRun(cliPath, args, options, tracePath) {
  const traceAvailable = run('/usr/bin/strace', ['-V'], { timeout: 10_000 }).status === 0
  if (!traceAvailable) throw new Error('GIT_TRACE_UNAVAILABLE')
  return run('/usr/bin/strace', [
    '-f', '-s', '65536',
    '-e', 'trace=execve',
    '-P', '/usr/bin/git',
    '-o', tracePath,
    '--', cliPath, ...args,
  ], options)
}

function verifyTransaction({
  repositoryPath,
  configPath,
  stateRoot,
  baseCommit,
  baseTestExitCode,
  configBefore,
  report,
  tracePath,
}) {
  const evidenceText = readFileSync(report.evidencePath, 'utf8')
  const evidence = JSON.parse(evidenceText)
  const makerWorkspace = join(stateRoot, 'worktrees', report.runId, 'maker')
  const verifierWorkspace = join(stateRoot, 'worktrees', report.runId, 'verifier')
  const makerParents = git(makerWorkspace, 'rev-list', '--parents', '-n', '1', report.makerCommit).split(/\s+/u)
  const changedPaths = git(makerWorkspace, 'diff', '--name-only', `${report.baseCommit}..${report.makerCommit}`)
    .split('\n').filter(Boolean)
  const verifierTest = run(process.execPath, ['--test', 'test/add.test.mjs'], {
    cwd: verifierWorkspace,
    env: safeEnvironment(),
    timeout: 30_000,
  })
  const trace = inspectGitTrace(tracePath)

  return {
    baseTestFailed: baseTestExitCode === 1,
    makerIsExactlyOneNonMergeChild: makerParents.length === 2
      && makerParents[0] === report.makerCommit
      && makerParents[1] === report.baseCommit
      && git(makerWorkspace, 'rev-list', '--count', `${report.baseCommit}..${report.makerCommit}`) === '1',
    approvedChangedPathsOnly: changedPaths.length === 1 && changedPaths[0] === 'src/add.mjs',
    verifierAtExactMakerCommit: git(verifierWorkspace, 'rev-parse', 'HEAD') === report.makerCommit
      && report.verifierCommit === report.makerCommit,
    verifierTestPassed: verifierTest.status === 0
      && verifierTest.error === undefined
      && verifierTest.signal === null,
    verifierWorktreeClean: git(verifierWorkspace, 'status', '--porcelain') === '',
    originalCheckoutAtBase: git(repositoryPath, 'rev-parse', 'HEAD') === baseCommit,
    originalCheckoutClean: git(repositoryPath, 'status', '--porcelain') === '',
    originalConfigUnchanged: readFileSync(configPath, 'utf8') === configBefore,
    originalDefectUnchanged: readFileSync(join(repositoryPath, 'src', 'add.mjs'), 'utf8')
      === 'export function add(a, b) { return a - b }\n',
    stateOutsideTarget: pathsDisjoint(repositoryPath, stateRoot)
      && pathsDisjoint(repositoryPath, report.evidencePath)
      && pathsDisjoint(repositoryPath, makerWorkspace)
      && pathsDisjoint(repositoryPath, verifierWorkspace),
    evidenceDigestMatches: createHash('sha256').update(evidenceText).digest('hex') === report.evidenceDigest,
    evidenceBindingMatches: evidence.baseCommit === report.baseCommit
      && evidence.maker.commit === report.makerCommit
      && evidence.maker.parentCommit === report.baseCommit
      && evidence.verifier.commit === report.makerCommit
      && evidence.objectiveGate.commit === report.makerCommit
      && evidence.objectiveGate.passed === true
      && evidence.objectiveGate.checks.tests === true,
    noRemoteConfigured: git(repositoryPath, 'remote') === '',
    tracedGitInvocationCount: trace.tracedGitInvocationCount,
    forbiddenGitInvocationCount: trace.forbiddenGitInvocationCount,
    networkGitTargetCount: trace.networkGitTargetCount,
  }
}

const parsed = parseArguments(process.argv.slice(2))
if (parsed.error !== undefined) {
  fail(parsed.error, 2)
} else if (!parsed.acknowledged) {
  fail('ACKNOWLEDGMENT_REQUIRED', 2)
} else {
  const demoRoot = mkdtempSync(join(tmpdir(), 'agent-loop-productized-runtime-'))
  try {
    const { cliPath, prefixDirectory, tarballPath } = packageAndInstall(demoRoot)
    const { repositoryPath, configPath, workItemPath } = createTarget(demoRoot)
    const stateRoot = join(demoRoot, 'external-state')
    const tracePath = join(demoRoot, 'git-execve.trace')
    const baseCommit = git(repositoryPath, 'rev-parse', 'HEAD')
    const configBefore = readFileSync(configPath, 'utf8')
    const baseTest = run(process.execPath, ['--test', 'test/add.test.mjs'], {
      cwd: repositoryPath,
      env: safeEnvironment(),
      timeout: 30_000,
    })
    if (baseTest.status !== 1) throw new Error('BASE_DEFECT_NOT_REPRODUCED')

    const doctor = run(cliPath, [
      'doctor', '--repo', repositoryPath, '--state-root', stateRoot, '--json',
    ], { cwd: demoRoot, env: safeEnvironment(), timeout: 30_000 })
    const doctorReport = normalizeDoctorReport(JSON.parse(requireSuccess(doctor, 'DOCTOR_FAILED')))

    const transaction = traceInstalledRun(cliPath, [
      'run',
      '--repo', repositoryPath,
      '--work-item', workItemPath,
      '--state-root', stateRoot,
      ACKNOWLEDGMENT,
      '--json',
    ], { cwd: demoRoot, env: safeEnvironment(), timeout: 10 * 60_000 }, tracePath)
    const report = normalizeRunReport(
      JSON.parse(requireSuccess(transaction, 'TRANSACTION_FAILED')),
      stateRoot,
    )

    const verification = verifyTransaction({
      repositoryPath,
      configPath,
      stateRoot,
      baseCommit,
      baseTestExitCode: baseTest.status,
      configBefore,
      report,
      tracePath,
    })
    if (!Object.entries(verification).every(([key, value]) => {
      if (key === 'tracedGitInvocationCount') return Number.isSafeInteger(value) && value > 0
      if (key.endsWith('Count')) return value === 0
      return value === true
    })) {
      throw new Error('INDEPENDENT_VERIFICATION_FAILED')
    }

    emit({
      schemaVersion: 1,
      status: 'pass',
      retained: parsed.keep,
      paths: parsed.keep ? {
        demoRoot,
        targetRepository: repositoryPath,
        stateRoot,
        evidencePath: report.evidencePath,
        makerWorktree: join(stateRoot, 'worktrees', report.runId, 'maker'),
        verifierWorktree: join(stateRoot, 'worktrees', report.runId, 'verifier'),
        toolsPrefix: prefixDirectory,
        packageTarball: tarballPath,
        gitTrace: tracePath,
      } : null,
      doctor: doctorReport,
      run: { ...report },
      verification,
    })
  } catch (error) {
    const code = typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : 'DEMO_INTERNAL_FAILURE'
    fail(code, 3)
  } finally {
    if (!parsed.keep && existsSync(demoRoot)) {
      rmSync(demoRoot, { recursive: true, force: true })
    }
  }
}
