import { createHash } from 'node:crypto'
import { existsSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { assertMakerRuntime } from '../core/evidence.mjs'
import { prepareStateDirectory } from '../paths/state-mutation.mjs'
import { runCommand } from './command.mjs'

const GIT = '/usr/bin/git'
const COMMAND_TIMEOUT_MS = 30_000
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const HARDENED_GIT_OPTIONS = [
  '--no-optional-locks',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'commit.gpgSign=false',
  '-c', 'credential.helper=',
  '-c', 'protocol.file.allow=never',
]

export class GitTransactionError extends Error {
  constructor(code, detail = '') {
    const detailDigest = createHash('sha256').update(String(detail)).digest('hex')
    super(`${code}: ${detailDigest}`)
    this.name = 'GitTransactionError'
    this.code = code
    this.detailDigest = detailDigest
  }
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

function execute(executable, args, cwd, commandRunner, env = null) {
  return commandRunner(executable, args, {
    cwd,
    env: env ?? { HOME: cwd, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  })
}

function gitResult(repositoryRoot, args, commandRunner) {
  return execute(
    GIT,
    [...HARDENED_GIT_OPTIONS, '-C', repositoryRoot, ...args],
    repositoryRoot,
    commandRunner,
    { HOME: '/dev/null', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  )
}

function requireResult(result, code, { trim = true } = {}) {
  if (result.status !== 0 || result.errorCode !== null) {
    throw new GitTransactionError(code, `${result.status}\0${result.errorCode}\0${result.stderr}\0${result.stdout}`)
  }
  return trim ? result.stdout.trim() : result.stdout
}

function requireGit(repositoryRoot, args, code, commandRunner) {
  return requireResult(gitResult(repositoryRoot, args, commandRunner), code)
}

function requireGitRaw(repositoryRoot, args, code, commandRunner) {
  return requireResult(gitResult(repositoryRoot, args, commandRunner), code, { trim: false })
}

function runConfiguredTests(workspace, config, commandRunner) {
  return execute(config.test.executable, config.test.args, workspace, commandRunner)
}

function resolveOwnedWorktreeAdmin(repositoryRoot, workspace, commandRunner) {
  const commonDirectory = realpathSync(requireGit(
    repositoryRoot,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    'WORKTREE_OWNERSHIP_UNAVAILABLE',
    commandRunner,
  ))
  const adminDirectory = realpathSync(requireGit(
    workspace,
    ['rev-parse', '--absolute-git-dir'],
    'WORKTREE_OWNERSHIP_UNAVAILABLE',
    commandRunner,
  ))
  if (dirname(adminDirectory) !== join(commonDirectory, 'worktrees')) {
    throw new GitTransactionError('WORKTREE_OWNERSHIP_UNAVAILABLE', adminDirectory)
  }
  return adminDirectory
}

function cleanupWorktrees(repositoryRoot, worktrees, commandRunner) {
  for (const { workspace, adminDirectory } of worktrees) {
    gitResult(repositoryRoot, ['worktree', 'unlock', workspace], commandRunner)
    gitResult(repositoryRoot, ['worktree', 'remove', '--force', '--force', workspace], commandRunner)
    if (adminDirectory !== null && existsSync(adminDirectory)) {
      rmSync(adminDirectory, { recursive: true, force: true })
    }
  }
}

function cleanupOwnedTransaction(repositoryRoot, makerBranch, worktrees, commandRunner) {
  cleanupWorktrees(repositoryRoot, worktrees, commandRunner)
  gitResult(repositoryRoot, ['branch', '-D', makerBranch], commandRunner)
}

function branchForRun(runId) {
  if (!RUN_ID.test(runId)) throw new GitTransactionError('RUN_ID_INVALID', runId)
  return `agent-loop/${runId}-maker`
}

export function assertMakerBranchAvailable({ repositoryRoot, runId, commandRunner = runCommand }) {
  const branch = branchForRun(runId)
  const result = gitResult(
    repositoryRoot,
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    commandRunner,
  )
  if (result.status === 0) throw new GitTransactionError('MAKER_BRANCH_ALREADY_EXISTS', branch)
  if (result.status !== 1 || result.errorCode !== null) {
    throw new GitTransactionError('MAKER_BRANCH_OWNERSHIP_UNKNOWN', `${result.status}\0${result.errorCode}`)
  }
  return branch
}

export async function runGitTransaction({
  repositoryRoot,
  paths,
  run,
  workItem,
  config,
  makerExecutor,
  commandRunner = runCommand,
}) {
  if (typeof makerExecutor !== 'function') throw new GitTransactionError('MAKER_EXECUTOR_REQUIRED')
  const makerBranch = assertMakerBranchAvailable({ repositoryRoot, runId: run.runId, commandRunner })
  const originalHead = requireGit(repositoryRoot, ['rev-parse', 'HEAD'], 'ORIGINAL_HEAD_UNAVAILABLE', commandRunner)
  if (originalHead !== run.baseCommit) throw new GitTransactionError('ORIGINAL_HEAD_CHANGED', originalHead)
  if (requireGit(repositoryRoot, ['status', '--porcelain'], 'ORIGINAL_STATUS_UNAVAILABLE', commandRunner) !== '') {
    throw new GitTransactionError('ORIGINAL_WORKTREE_NOT_CLEAN')
  }

  const runWorktrees = join(paths.worktrees, run.runId)
  prepareStateDirectory(runWorktrees)
  const preflightWorkspace = join(runWorktrees, 'preflight')
  const makerWorkspace = join(runWorktrees, 'maker')
  const verifierWorkspace = join(runWorktrees, 'verifier')

  let preflightResult
  let preflightAdminDirectory = null
  try {
    requireGit(
      repositoryRoot,
      ['worktree', 'add', '--detach', preflightWorkspace, run.baseCommit],
      'PREFLIGHT_WORKTREE_CREATE_FAILED',
      commandRunner,
    )
    preflightAdminDirectory = resolveOwnedWorktreeAdmin(repositoryRoot, preflightWorkspace, commandRunner)
    preflightResult = runConfiguredTests(preflightWorkspace, config, commandRunner)
  } finally {
    cleanupWorktrees(repositoryRoot, [{
      workspace: preflightWorkspace,
      adminDirectory: preflightAdminDirectory,
    }], commandRunner)
  }
  if (
    preflightResult.errorCode !== null
    || !Number.isSafeInteger(preflightResult.status)
    || preflightResult.status < 0
  ) {
    throw new GitTransactionError(
      'PREFLIGHT_UNAVAILABLE',
      `${preflightResult.status}\0${preflightResult.signal}\0${preflightResult.errorCode}`,
    )
  }
  if (preflightResult.status === 0) throw new GitTransactionError('PREFLIGHT_DEFECT_NOT_REPRODUCED')
  const preflight = freezeDeep({
    runId: run.runId,
    commit: run.baseCommit,
    verdict: 'fail',
    exitCode: preflightResult.status,
  })

  requireGit(
    repositoryRoot,
    ['branch', makerBranch, run.baseCommit],
    'MAKER_BRANCH_CREATE_FAILED',
    commandRunner,
  )

  let makerAdminDirectory = null
  let verifierAdminDirectory = null
  try {
  requireGit(
    repositoryRoot,
    ['worktree', 'add', makerWorkspace, makerBranch],
    'MAKER_WORKTREE_CREATE_FAILED',
    commandRunner,
  )
  makerAdminDirectory = resolveOwnedWorktreeAdmin(repositoryRoot, makerWorkspace, commandRunner)

  let makerRuntime
  try {
    makerRuntime = await makerExecutor({ workspace: makerWorkspace, run, workItem, config })
  } catch (error) {
    throw new GitTransactionError('MAKER_EXECUTOR_FAILED', String(error?.message ?? error))
  }
  if (makerRuntime === undefined || makerRuntime === null) {
    throw new GitTransactionError('MAKER_RUNTIME_MISSING')
  }
  try {
    assertMakerRuntime(makerRuntime)
  } catch (error) {
    throw new GitTransactionError('MAKER_RUNTIME_INVALID', String(error?.message ?? error))
  }
  if (
    !config.maker || typeof config.maker !== 'object'
    || makerRuntime.usage.provider !== config.maker.provider
    || makerRuntime.usage.model !== config.maker.model
  ) {
    throw new GitTransactionError('MAKER_ROUTE_MISMATCH')
  }
  const makerTest = runConfiguredTests(makerWorkspace, config, commandRunner)
  if (makerTest.status !== 0 || makerTest.errorCode !== null) {
    throw new GitTransactionError('MAKER_TEST_FAILED', `${makerTest.status}\0${makerTest.errorCode}`)
  }

  const ancestry = requireGit(
    makerWorkspace,
    ['rev-list', '--parents', '-n', '1', 'HEAD'],
    'MAKER_ANCESTRY_UNAVAILABLE',
    commandRunner,
  ).split(/\s+/u)
  const makerCommit = ancestry[0]
  const parentCommit = ancestry[1]
  const commitCount = requireGit(
    makerWorkspace,
    ['rev-list', '--count', `${run.baseCommit}..${makerCommit}`],
    'MAKER_COMMIT_COUNT_UNAVAILABLE',
    commandRunner,
  )
  if (ancestry.length !== 2 || parentCommit !== run.baseCommit || commitCount !== '1') {
    throw new GitTransactionError('MAKER_COMMIT_NOT_SINGLE_CHILD', ancestry.join(' '))
  }

  const changedOutput = requireGitRaw(
    makerWorkspace,
    ['diff', '--no-renames', '--name-only', '-z', '--diff-filter=ACDMRTUXB', `${run.baseCommit}..${makerCommit}`],
    'MAKER_DIFF_UNAVAILABLE',
    commandRunner,
  )
  if (changedOutput !== '' && !changedOutput.endsWith('\0')) {
    throw new GitTransactionError('MAKER_DIFF_MALFORMED')
  }
  const changedPaths = changedOutput === '' ? [] : changedOutput.slice(0, -1).split('\0')
  if (changedPaths.length === 0 || changedPaths.some((path) => !config.allowedPaths.includes(path))) {
    throw new GitTransactionError('MAKER_CHANGED_UNAPPROVED_PATH', changedPaths.join('\0'))
  }
  if (requireGit(makerWorkspace, ['status', '--porcelain'], 'MAKER_STATUS_UNAVAILABLE', commandRunner) !== '') {
    throw new GitTransactionError('MAKER_WORKTREE_NOT_CLEAN')
  }

  const artifactId = createHash('sha256').update(JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    commit: makerCommit,
    parentCommit,
    changedPaths,
  })).digest('hex')
  const maker = freezeDeep({
    runId: run.runId,
    artifactId,
    commit: makerCommit,
    parentCommit,
    changedPaths: [...changedPaths],
  })

  requireGit(
    repositoryRoot,
    ['worktree', 'add', '--detach', verifierWorkspace, makerCommit],
    'VERIFIER_WORKTREE_CREATE_FAILED',
    commandRunner,
  )
  verifierAdminDirectory = resolveOwnedWorktreeAdmin(repositoryRoot, verifierWorkspace, commandRunner)
  const verifierHead = requireGit(
    verifierWorkspace,
    ['rev-parse', 'HEAD'],
    'VERIFIER_HEAD_UNAVAILABLE',
    commandRunner,
  )
  const verifierTest = runConfiguredTests(verifierWorkspace, config, commandRunner)
  const verifierPassed = verifierTest.status === 0 && verifierTest.errorCode === null
  const verifier = freezeDeep({
    runId: run.runId,
    artifactId,
    commit: verifierHead,
    verdict: verifierPassed ? 'pass' : 'fail',
    score: verifierPassed ? 1 : 0,
    exitCode: Number.isSafeInteger(verifierTest.status) ? verifierTest.status : -1,
  })

  const checks = {
    exactHead: verifierHead === makerCommit,
    clean: requireGit(verifierWorkspace, ['status', '--porcelain'], 'VERIFIER_STATUS_UNAVAILABLE', commandRunner) === '',
    originalHead: requireGit(repositoryRoot, ['rev-parse', 'HEAD'], 'ORIGINAL_HEAD_UNAVAILABLE', commandRunner) === run.baseCommit,
    originalClean: requireGit(repositoryRoot, ['status', '--porcelain'], 'ORIGINAL_STATUS_UNAVAILABLE', commandRunner) === '',
    tests: verifierPassed,
  }
  const objectiveGate = freezeDeep({
    runId: run.runId,
    artifactId,
    commit: verifierHead,
    checked: true,
    passed: Object.values(checks).every(Boolean),
    checks,
  })

  return freezeDeep({
    preflight,
    maker,
    makerRuntime,
    verifier,
    objectiveGate,
    workspaces: {
      preflight: preflightWorkspace,
      maker: makerWorkspace,
      verifier: verifierWorkspace,
    },
  })
  } catch (error) {
    cleanupOwnedTransaction(repositoryRoot, makerBranch, [
      { workspace: verifierWorkspace, adminDirectory: verifierAdminDirectory },
      { workspace: makerWorkspace, adminDirectory: makerAdminDirectory },
    ], commandRunner)
    if (error instanceof GitTransactionError) throw error
    throw new GitTransactionError('TRANSACTION_FAILED', String(error?.message ?? error))
  }
}
