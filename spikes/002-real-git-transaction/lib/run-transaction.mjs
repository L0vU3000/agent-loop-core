import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  applyVerification,
  createRunState,
  decideRecordOutcome,
  lockRubric,
  recordMakerArtifact,
} from '../../001-eve-bug-fix-runtime/agent/lib/runtime-adapter.mjs'
import { claimNextBugFix } from '../../001-eve-bug-fix-runtime/control-plane/dispatcher-adapter.mjs'
import { recordOutcome } from '../../../orchestrator/dispatch.mjs'

const GIT_BINARY = '/usr/bin/git'
const COMMAND_TIMEOUT_MS = 30_000
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024

function command(commandName, args, cwd, { environment: explicitEnvironment = {} } = {}) {
  // Cross the runtime boundary with an allowlist, not the parent process environment.
  // Repository tests are executable code and must not inherit provider keys or tokens.
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
    ...explicitEnvironment,
  }
  const executable = commandName === 'git' ? GIT_BINARY : commandName
  const commandArgs = commandName === 'git'
    ? ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false', ...args]
    : args
  const result = spawnSync(executable, commandArgs, {
    cwd,
    encoding: 'utf8',
    env: environment,
    timeout: COMMAND_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  })
  const timedOut = result.error?.code === 'ETIMEDOUT'
  return {
    command: [executable, ...commandArgs].join(' '),
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut,
    spawnError: result.error ? result.error.message : null,
    passed: result.status === 0 && !result.error,
  }
}

function requireCommand(commandName, args, cwd) {
  const result = command(commandName, args, cwd)
  if (!result.passed) {
    throw new Error(`${result.command} failed (${result.exitCode}): ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function worktreeIsRegistered(repositoryRoot, workspace) {
  const listed = command('git', ['worktree', 'list', '--porcelain'], repositoryRoot)
  if (!listed.passed) return true
  return listed.stdout.split('\n').includes(`worktree ${workspace}`)
}

function frozen(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child)
    Object.freeze(value)
  }
  return value
}

function safeBranchPart(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)
}

function canonicalizeProspectivePath(value) {
  let existingAncestor = resolve(value)
  const missingParts = []
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor)
    if (parent === existingAncestor) throw new Error(`no existing ancestor for path: ${value}`)
    missingParts.unshift(basename(existingAncestor))
    existingAncestor = parent
  }
  return resolve(realpathSync(existingAncestor), ...missingParts)
}

function isPathNestedWithin(parent, child) {
  const pathFromParent = relative(parent, child)
  return pathFromParent !== ''
    && pathFromParent !== '..'
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent)
}

function runTests(cwd, { objective = false } = {}) {
  return command(process.execPath, ['--test'], cwd, {
    environment: objective ? { AGENT_LOOP_OBJECTIVE_PHASE: '1' } : {},
  })
}

function createRunIdentity({ runId, claimed, workItem, baseCommit }) {
  return frozen({
    schemaVersion: 1,
    runId,
    file: claimed.file,
    pipeline: claimed.pipeline,
    workItemSha256: sha256(workItem),
    baseCommit,
    maxIterations: 1,
  })
}

function requireExpectedFixtureDefect(workspace) {
  const target = join(workspace, 'src', 'add.mjs')
  const before = readFileSync(target, 'utf8')
  const after = before.replace('return a - b', 'return a + b')
  if (after === before) throw new Error('fixture defect was not found in src/add.mjs')
  writeFileSync(target, after)
}

export function assertEvidenceBinding(run, maker, verification, objectiveGate) {
  for (const evidence of [maker, verification, objectiveGate]) {
    if (evidence.runId !== run.runId) throw new Error('RUN_ID_MISMATCH')
  }
  if (verification.artifactId !== maker.artifactId || objectiveGate.artifactId !== maker.artifactId) {
    throw new Error('ARTIFACT_ID_MISMATCH')
  }
  if (verification.commit !== maker.commit || objectiveGate.commit !== maker.commit) {
    throw new Error('EVIDENCE_COMMIT_MISMATCH')
  }
}

function persistEvidence(agentLoopRoot, evidence) {
  const evidenceDirectory = join(agentLoopRoot, 'orchestrator', 'evidence')
  mkdirSync(evidenceDirectory, { recursive: true })
  const evidencePath = join('orchestrator', 'evidence', `${evidence.run.runId}.json`)
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  const evidenceSha256 = sha256(serialized)
  writeFileSync(join(agentLoopRoot, evidencePath), serialized, { flag: 'wx', mode: 0o600 })
  return { evidencePath, evidenceSha256 }
}

function persistFailureEvidence(agentLoopRoot, runId, evidence) {
  const evidenceDirectory = join(agentLoopRoot, 'orchestrator', 'evidence')
  mkdirSync(evidenceDirectory, { recursive: true })
  const evidencePath = join('orchestrator', 'evidence', `${runId}.failure.json`)
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  const evidenceSha256 = sha256(serialized)
  writeFileSync(join(agentLoopRoot, evidencePath), serialized, { flag: 'wx', mode: 0o600 })
  return { evidencePath, evidenceSha256 }
}

function recordClaimedGitTransaction(agentLoopRoot, file, evidence) {
  const outcome = decideRecordOutcome(evidence)
  const persisted = persistEvidence(agentLoopRoot, { ...evidence, decision: outcome })
  const recorded = recordOutcome(
    agentLoopRoot,
    file,
    outcome,
    `git transaction: verifier=${evidence.verification?.verdict ?? 'missing'}, objective-gate=${evidence.objectiveGate?.passed === true ? 'pass' : 'fail'}, evidence=${persisted.evidencePath}, sha256=${persisted.evidenceSha256}`,
  )
  return { outcome, ...recorded, ...persisted }
}

export async function runRealGitTransaction({
  agentLoopRoot,
  repositoryRoot,
  workspaceRoot,
  runId,
  rubric,
  makerExecutor,
  allowedMakerPaths = ['src/add.mjs'],
}) {
  if (!runId || safeBranchPart(runId) !== runId) {
    throw new Error('runId must contain at most 80 letters, numbers, dots, underscores, or hyphens')
  }
  const roots = [agentLoopRoot, repositoryRoot, workspaceRoot]
  if (roots.some((root) => !isAbsolute(root))) throw new Error('all transaction roots must be absolute paths')
  const resolvedRoots = roots.map(canonicalizeProspectivePath)
  if (new Set(resolvedRoots).size !== roots.length) {
    throw new Error('control-plane, repository, and workspace roots must be distinct')
  }
  const rootsOverlap = resolvedRoots.some((root, index) => (
    resolvedRoots.some((other, otherIndex) => index !== otherIndex && isPathNestedWithin(other, root))
  ))
  if (rootsOverlap) throw new Error('transaction roots must not overlap or nest')
  if (existsSync(workspaceRoot)) throw new Error('workspace root must not already exist')
  if (!Array.isArray(allowedMakerPaths) || allowedMakerPaths.length === 0 || allowedMakerPaths.some((path) => (
    typeof path !== 'string'
    || path.length === 0
    || isAbsolute(path)
    || path === '..'
    || path.startsWith(`..${sep}`)
    || path.includes('\\')
    || path.includes('\0')
  ))) {
    throw new Error('allowedMakerPaths must contain safe repository-relative Git paths')
  }

  const makerBranch = `agent-loop/${safeBranchPart(runId)}-maker`
  const existingMakerBranch = command('git', ['show-ref', '--verify', '--quiet', `refs/heads/${makerBranch}`], repositoryRoot)
  if (existingMakerBranch.exitCode === 0) throw new Error('maker branch already exists')
  if (existingMakerBranch.exitCode !== 1 || existingMakerBranch.spawnError) {
    throw new Error('could not establish maker branch ownership')
  }

  const claimed = claimNextBugFix(agentLoopRoot)
  if (!claimed) throw new Error('no bug-fix item is available to claim')

  const makerWorkspace = join(workspaceRoot, 'maker')
  const verifierWorkspace = join(workspaceRoot, 'verifier')
  let makerBranchCreated = false

  try {
  const claimedItemPath = join(agentLoopRoot, 'orchestrator', 'inbox', 'in-progress', claimed.file)
  const workItem = readFileSync(claimedItemPath, 'utf8')
  const baseCommit = requireCommand('git', ['rev-parse', 'HEAD'], repositoryRoot)
  const run = createRunIdentity({ runId, claimed, workItem, baseCommit })

  if (requireCommand('git', ['status', '--porcelain'], repositoryRoot) !== '') {
    throw new Error('fixture repository must be clean before the base-commit preflight')
  }

  const preflightResult = runTests(repositoryRoot)
  if (preflightResult.timedOut || preflightResult.spawnError) {
    throw new Error(`preflight could not establish the defect: ${preflightResult.spawnError ?? 'timed out'}`)
  }
  const preflight = frozen({
    runId: run.runId,
    commit: baseCommit,
    verdict: preflightResult.passed ? 'pass' : 'fail',
    command: preflightResult.command,
    exitCode: preflightResult.exitCode,
  })
  if (preflight.verdict !== 'fail') throw new Error('fixture defect was not reproduced at the base commit')

  mkdirSync(workspaceRoot, { recursive: true })
  requireCommand('git', ['branch', makerBranch, baseCommit], repositoryRoot)
  makerBranchCreated = true
  requireCommand('git', ['worktree', 'add', makerWorkspace, makerBranch], repositoryRoot)

  let makerRuntime = null
  if (makerExecutor) {
    makerRuntime = frozen(await makerExecutor({
      workspace: makerWorkspace,
      run,
      claim: frozen(claimed),
      workItem,
    }))
  } else {
    requireExpectedFixtureDefect(makerWorkspace)
    requireCommand('git', ['add', 'src/add.mjs'], makerWorkspace)
    requireCommand('git', ['commit', '-m', `fix: repair add for ${run.runId}`], makerWorkspace)
  }
  const makerTest = runTests(makerWorkspace)
  if (!makerTest.passed) throw new Error(`maker result did not pass tests: ${makerTest.stderr || makerTest.stdout}`)
  const makerAncestry = requireCommand('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], makerWorkspace).split(/\s+/)
  const makerCommit = makerAncestry[0]
  const parentCommit = makerAncestry[1]
  const commitsAfterBase = requireCommand('git', ['rev-list', '--count', `${baseCommit}..${makerCommit}`], makerWorkspace)
  if (makerAncestry.length !== 2 || parentCommit !== baseCommit || commitsAfterBase !== '1') {
    throw new Error('MAKER_COMMIT_NOT_SINGLE_CHILD')
  }
  const changedPathsOutput = requireCommand('git', ['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${baseCommit}..${makerCommit}`], makerWorkspace)
  const changedPaths = changedPathsOutput === '' ? [] : changedPathsOutput.split('\n')
  if (changedPaths.length === 0 || changedPaths.some((path) => !allowedMakerPaths.includes(path))) {
    throw new Error('MAKER_CHANGED_UNAPPROVED_PATH')
  }
  if (requireCommand('git', ['status', '--porcelain'], makerWorkspace) !== '') {
    throw new Error('MAKER_WORKTREE_NOT_CLEAN')
  }
  const artifactId = sha256(JSON.stringify({
    schemaVersion: 1,
    runId: run.runId,
    iteration: 1,
    branch: makerBranch,
    commit: makerCommit,
    parentCommit,
  }))
  const maker = frozen({
    schemaVersion: 1,
    runId: run.runId,
    iteration: 1,
    branch: makerBranch,
    commit: makerCommit,
    parentCommit,
    artifactId,
    workspace: makerWorkspace,
    changedPaths: frozen([...changedPaths]),
    ...(makerRuntime ? { runtime: makerRuntime } : {}),
  })

  let state = lockRubric(createRunState({
    runId: run.runId,
    file: run.file,
    maxIterations: run.maxIterations,
  }), rubric)
  state = recordMakerArtifact(state, maker)

  requireCommand('git', ['worktree', 'add', '--detach', verifierWorkspace, maker.commit], repositoryRoot)
  const verifierHead = requireCommand('git', ['rev-parse', 'HEAD'], verifierWorkspace)
  const verifierTest = runTests(verifierWorkspace)
  const verification = frozen({
    schemaVersion: 1,
    runId: run.runId,
    artifactId: maker.artifactId,
    verifier: 'independent-git-worktree',
    workspace: verifierWorkspace,
    commit: verifierHead,
    verdict: verifierTest.passed ? 'pass' : 'fail',
    score: verifierTest.passed ? 1 : 0,
    command: verifierTest.command,
    exitCode: verifierTest.exitCode,
  })
  state = applyVerification(state, verification)

  const objectiveTest = runTests(verifierWorkspace, { objective: true })
  const objectiveHead = requireCommand('git', ['rev-parse', 'HEAD'], verifierWorkspace)
  const exactHead = objectiveHead === maker.commit
  const clean = requireCommand('git', ['status', '--porcelain'], verifierWorkspace) === ''
  const originalHead = requireCommand('git', ['rev-parse', 'HEAD'], repositoryRoot) === baseCommit
  const originalClean = requireCommand('git', ['status', '--porcelain'], repositoryRoot) === ''
  const objectiveGate = frozen({
    schemaVersion: 1,
    runId: run.runId,
    artifactId: maker.artifactId,
    commit: objectiveHead,
    checked: true,
    passed: exactHead && clean && originalHead && originalClean && objectiveTest.passed,
    checks: frozen({
      exactHead,
      clean,
      originalHead,
      originalClean,
      tests: objectiveTest.passed,
    }),
  })

  assertEvidenceBinding(run, maker, verification, objectiveGate)
  const record = frozen(recordClaimedGitTransaction(agentLoopRoot, claimed.file, {
    run,
    claim: claimed,
    preflight,
    maker,
    verification: state.verification,
    objectiveGate,
  }))

  return frozen({
    run,
    claim: frozen(claimed),
    preflight,
    maker,
    verification,
    objectiveGate,
    record,
  })
  } catch (error) {
    const cleanup = []
    for (const workspace of [verifierWorkspace, makerWorkspace]) {
      command('git', ['worktree', 'unlock', workspace], repositoryRoot)
      const removed = command('git', ['worktree', 'remove', '--force', '--force', workspace], repositoryRoot)
      cleanup.push({
        workspace,
        removedByCommand: removed.passed,
        errorSha256: removed.passed ? null : sha256(String(removed.stderr || removed.spawnError || 'unknown cleanup failure')),
      })
    }
    command('git', ['worktree', 'prune', '--expire', 'now'], repositoryRoot)
    for (const entry of cleanup) entry.registeredAfter = worktreeIsRegistered(repositoryRoot, entry.workspace)

    let deletedBranch = null
    if (makerBranchCreated) {
      deletedBranch = command('git', ['branch', '-D', makerBranch], repositoryRoot)
      if (!deletedBranch.passed) {
        command('git', ['worktree', 'prune', '--expire', 'now'], repositoryRoot)
        deletedBranch = command('git', ['branch', '-D', makerBranch], repositoryRoot)
      }
    }
    const makerBranchPresentAfter = command(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${makerBranch}`],
      repositoryRoot,
    ).passed

    const failureEvidence = {
      schemaVersion: 1,
      run: {
        runId,
        file: claimed.file,
        pipeline: claimed.pipeline,
      },
      decision: 'fail',
      failure: {
        message: 'transaction failed',
        errorSha256: sha256(String(error.message ?? error)),
      },
      cleanup: {
        worktrees: cleanup,
        makerBranchDeleted: deletedBranch === null
          ? false
          : deletedBranch.passed || /not found/.test(deletedBranch.stderr),
        makerBranchPresentAfter,
      },
    }
    let persisted = null
    try {
      persisted = persistFailureEvidence(agentLoopRoot, runId, failureEvidence)
    } catch (persistenceError) {
      failureEvidence.persistenceError = String(persistenceError.message ?? persistenceError).slice(0, 1000)
    }

    const claimedItem = join(agentLoopRoot, 'orchestrator', 'inbox', 'in-progress', claimed.file)
    if (existsSync(claimedItem)) {
      const evidenceNote = persisted
        ? `, evidence=${persisted.evidencePath}, sha256=${persisted.evidenceSha256}`
        : ''
      recordOutcome(
        agentLoopRoot,
        claimed.file,
        'fail',
        `git transaction aborted: ${failureEvidence.failure.message}${evidenceNote}`,
      )
    }
    throw error
  }
}
