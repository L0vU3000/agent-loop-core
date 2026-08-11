import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

import { loadConfig } from '../config/load-config.mjs'
import { createRunIdentity, recordEvidence } from '../core/evidence.mjs'
import { claimWorkItem, resolveWorkItem } from '../core/work-items.mjs'
import { deriveRepositoryState } from '../paths/repository-state.mjs'
import { findExecutable, runCommand } from '../runtime/command.mjs'
import { assertMakerBranchAvailable, runGitTransaction } from '../runtime/git-transaction.mjs'
import { createHermesMaker } from '../runtime/hermes-maker.mjs'
import { runDoctor } from './doctor.mjs'

const GIT = '/usr/bin/git'
const HARDENED_GIT_OPTIONS = [
  '--no-optional-locks',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null',
]
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

function defaultGenerateRunId() {
  return randomUUID()
}

function resolveBaseCommit(repositoryRoot, commandRunner, env) {
  const result = commandRunner(
    GIT,
    [...HARDENED_GIT_OPTIONS, '-C', repositoryRoot, 'rev-parse', 'HEAD'],
    { env },
  )
  if (result.status !== 0 || result.errorCode !== null || result.signal !== null) {
    throw new Error('base commit unavailable')
  }
  const commit = result.stdout.trim()
  if (!COMMIT.test(commit)) throw new Error('base commit unavailable')
  return commit
}

function freezeReport(report) {
  return Object.freeze({ ...report, json: Object.freeze({ ...report.json }) })
}

function preconditionReport(code) {
  return freezeReport({
    exitCode: 2,
    json: { schemaVersion: 1, error: code },
    human: `Run result: precondition failed (${code}).\n`,
  })
}

function internalErrorReport(code) {
  return freezeReport({
    exitCode: 3,
    json: { schemaVersion: 1, error: code },
    human: `Run result: internal failure (${code}).\n`,
  })
}

function recordedReport({ run, transaction, decision, evidence, stateRoot }) {
  const json = {
    schemaVersion: 1,
    runId: run.runId,
    decision,
    baseCommit: run.baseCommit,
    makerCommit: transaction.maker.commit,
    verifierCommit: transaction.verifier.commit,
    evidencePath: evidence.evidencePath,
    evidenceDigest: evidence.evidenceDigest,
    stateRoot,
  }
  const human = [
    `Run ${run.runId}: ${decision === 'pass' ? 'PASS' : 'FAIL'}`,
    `Base commit: ${run.baseCommit}`,
    `Maker commit: ${transaction.maker.commit}`,
    `Verifier commit: ${transaction.verifier.commit}`,
    `Evidence: ${evidence.evidencePath} (${evidence.evidenceDigest})`,
    `State root: ${stateRoot}`,
    '',
  ].join('\n')
  return freezeReport({ exitCode: decision === 'pass' ? 0 : 1, json, human })
}

function safelyResolve(resolveWorkItemFn, paths, workItemDigest, outcome) {
  try {
    resolveWorkItemFn({ paths, workItemDigest, outcome })
  } catch {
    // Best-effort only: the primary failure code already governs the exit status.
  }
}

// Composes doctor -> canonical config/state/base commit -> branch ownership precheck -> external
// claim -> immutable run identity -> Hermes maker -> Git transaction -> normalized evidence ->
// claim resolution. Every stage is injectable so tests can prove ordering and each exit-code path
// without weakening the composition the real CLI uses by default.
export async function runAgentLoopRun(options, {
  env = process.env,
  runDoctorFn = runDoctor,
  deriveRepositoryStateFn = deriveRepositoryState,
  loadConfigFn = loadConfig,
  resolveBaseCommitFn = resolveBaseCommit,
  assertMakerBranchAvailableFn = assertMakerBranchAvailable,
  claimWorkItemFn = claimWorkItem,
  createRunIdentityFn = createRunIdentity,
  findExecutableFn = findExecutable,
  createHermesMakerFn = createHermesMaker,
  runGitTransactionFn = runGitTransaction,
  recordEvidenceFn = recordEvidence,
  resolveWorkItemFn = resolveWorkItem,
  commandRunner = runCommand,
  generateRunId = defaultGenerateRunId,
} = {}) {
  if (options.acknowledgeUnsandboxedCredentialAccess !== true) {
    return preconditionReport('ACKNOWLEDGMENT_REQUIRED')
  }
  const doctorReport = runDoctorFn(options, { env })
  if (!doctorReport.healthy) return preconditionReport('DOCTOR_UNHEALTHY')

  let state
  let config
  let baseCommit
  try {
    state = deriveRepositoryStateFn({
      repositoryPath: options.repo,
      stateRoot: options.stateRoot,
      env,
    })
    const configPath = options.config === undefined
      ? join(state.repositoryRoot, '.agent-loop', 'config.json')
      : resolve(options.config)
    config = loadConfigFn(configPath)
    baseCommit = resolveBaseCommitFn(state.repositoryRoot, commandRunner, env)
  } catch {
    return preconditionReport('TARGET_UNREADY')
  }

  let hermesExecutable
  try {
    hermesExecutable = findExecutableFn(
      'hermes',
      env,
      [state.repositoryRoot, state.gitCommonDirectory],
    )
  } catch {
    return preconditionReport('HERMES_UNAVAILABLE')
  }
  if (hermesExecutable === null) return preconditionReport('HERMES_UNAVAILABLE')

  const runId = generateRunId()
  try {
    assertMakerBranchAvailableFn({ repositoryRoot: state.repositoryRoot, runId, commandRunner })
  } catch {
    return preconditionReport('MAKER_BRANCH_UNAVAILABLE')
  }

  let claim
  try {
    claim = claimWorkItemFn({ paths: state.paths, workItemPath: options.workItem })
  } catch (error) {
    if (String(error?.message ?? '').startsWith('WORK_ITEM_ALREADY_CLAIMED')) {
      return preconditionReport('WORK_ITEM_ALREADY_CLAIMED')
    }
    return preconditionReport('WORK_ITEM_CLAIM_FAILED')
  }

  const configDigest = createHash('sha256').update(JSON.stringify(config)).digest('hex')
  let run
  try {
    run = createRunIdentityFn({
      paths: state.paths,
      runId,
      repositoryKey: state.repositoryKey,
      baseCommit,
      configDigest,
      workItemDigest: claim.workItemDigest,
    })
  } catch {
    safelyResolve(resolveWorkItemFn, state.paths, claim.workItemDigest, 'fail')
    return internalErrorReport('RUN_IDENTITY_FAILED')
  }

  let maker
  try {
    maker = createHermesMakerFn({
      executable: hermesExecutable,
      provider: config.maker.provider,
      model: config.maker.model,
      timeoutMs: config.maker.timeoutMs,
      acknowledgeUnsandboxedCredentialAccess: options.acknowledgeUnsandboxedCredentialAccess === true,
      commandRunner,
    })
  } catch {
    safelyResolve(resolveWorkItemFn, state.paths, claim.workItemDigest, 'fail')
    return internalErrorReport('HERMES_MAKER_UNAVAILABLE')
  }

  let transaction
  try {
    transaction = await runGitTransactionFn({
      repositoryRoot: state.repositoryRoot,
      paths: state.paths,
      run,
      workItem: claim.content,
      config,
      makerExecutor: maker,
      commandRunner,
    })
  } catch {
    safelyResolve(resolveWorkItemFn, state.paths, claim.workItemDigest, 'fail')
    return internalErrorReport('GIT_TRANSACTION_FAILED')
  }

  const decision = transaction.objectiveGate.passed ? 'pass' : 'fail'
  let evidence
  try {
    evidence = recordEvidenceFn({
      paths: state.paths,
      run,
      maker: transaction.maker,
      verifier: transaction.verifier,
      objectiveGate: transaction.objectiveGate,
      makerRuntime: transaction.makerRuntime,
      decision,
    })
  } catch {
    safelyResolve(resolveWorkItemFn, state.paths, claim.workItemDigest, 'fail')
    return internalErrorReport('EVIDENCE_RECORDING_FAILED')
  }

  try {
    resolveWorkItemFn({ paths: state.paths, workItemDigest: claim.workItemDigest, outcome: decision })
  } catch {
    return internalErrorReport('WORK_ITEM_RESOLUTION_FAILED')
  }

  return recordedReport({ run, transaction, decision, evidence, stateRoot: state.stateRoot })
}
