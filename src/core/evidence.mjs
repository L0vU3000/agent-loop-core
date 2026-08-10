import { createHash } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { TextDecoder } from 'node:util'

import {
  openChildDirectoryNoFollow,
  openExistingDirectoryNoFollow,
  readUtf8RegularFileAt,
} from '../paths/state-access.mjs'
import { prepareStateDirectory } from '../paths/state-mutation.mjs'

const HEX64 = /^[a-f0-9]{64}$/
const REPOSITORY_KEY = /^[a-f0-9]{24}$/
const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const RUN_KEYS = ['schemaVersion', 'runId', 'repositoryKey', 'baseCommit', 'configDigest', 'workItemDigest']
const EVIDENCE_KEYS = [
  'schemaVersion',
  'runId',
  'repositoryKey',
  'baseCommit',
  'configDigest',
  'workItemDigest',
  'maker',
  'verifier',
  'objectiveGate',
  'makerRuntime',
  'decision',
]
const MAX_EVIDENCE_BYTES = 256 * 1024
const MAX_LEDGER_BYTES = 16 * 1024 * 1024
const OBJECTIVE_CHECK_IDS = Object.freeze([
  'exactHead',
  'clean',
  'originalHead',
  'originalClean',
  'tests',
])
// Canonical runtime bounds shared by the Hermes maker producer and the evidence schema.
// They are exported so the producer can mechanically enforce the same ceiling before the
// result reaches the evidence boundary, preventing drift.
export const MAKER_RUNTIME_BOUNDS = Object.freeze({
  maxOutputBytes: 1024 * 1024,
  minApiCalls: 1,
  maxApiCalls: 1_000_000,
  maxTotalTokens: 1_000_000_000,
  maxEstimatedCostUsd: 1_000_000,
})

const SAFE_MAKER_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function readUtf8RegularFileNoFollow(filePath, maximumBytes, label) {
  let descriptor
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    throw new Error(`${label} must be a readable regular file`)
  }
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile()) throw new Error(`${label} must be a regular file`)
    if (metadata.size > maximumBytes) throw new Error(`${label} exceeds size limit`)
    const bytes = Buffer.alloc(maximumBytes + 1)
    let bytesRead = 0
    while (bytesRead < bytes.length) {
      const count = readSync(descriptor, bytes, bytesRead, bytes.length - bytesRead, bytesRead)
      if (count === 0) break
      bytesRead += count
    }
    if (bytesRead > maximumBytes) throw new Error(`${label} exceeds size limit`)
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))
    } catch {
      throw new Error(`${label} must contain valid UTF-8`)
    }
  } finally {
    closeSync(descriptor)
  }
}

function ledgerContains(paths, runId, evidenceDigest, expectedRecord = null, ledgerText = undefined) {
  if (ledgerText === undefined && !existsSync(paths.dispatchLog)) return false
  const text = ledgerText ?? readUtf8RegularFileNoFollow(
    paths.dispatchLog,
    MAX_LEDGER_BYTES,
    'dispatch ledger',
  )
  let matches = 0
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      throw new Error('dispatch ledger must contain valid JSONL')
    }
    if (entry.runId !== runId) continue
    if (entry.evidenceDigest !== evidenceDigest) throw new Error(`LEDGER_CONFLICT: ${runId}`)
    if (expectedRecord !== null) {
      requireOnlyKeys(entry, [...EVIDENCE_KEYS, 'evidenceDigest'], 'dispatch ledger entry')
      const { evidenceDigest: normalizedDigest, ...evidenceFields } = entry
      if (!HEX64.test(normalizedDigest)) throw new Error('dispatch ledger evidenceDigest must be a sha256 hex digest')
      const normalizedEntry = normalizeEvidenceRecord(evidenceFields)
      if (JSON.stringify(normalizedEntry) !== JSON.stringify(expectedRecord)) {
        throw new Error(`LEDGER_CONFLICT: ${runId}`)
      }
    }
    matches += 1
  }
  if (matches > 1) throw new Error(`LEDGER_DUPLICATE: ${runId}`)
  return matches === 1
}

function reserveEvidenceRecording(paths, runId) {
  const runDirectory = join(paths.runs, runId)
  prepareStateDirectory(runDirectory)
  const lockPath = join(runDirectory, '.record-evidence.lock')
  try {
    mkdirSync(lockPath, { mode: 0o700 })
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`EVIDENCE_RECORDING_IN_PROGRESS: ${runId}`)
    throw error
  }
  return lockPath
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
}

function requireOnlyKeys(value, allowedKeys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} must not contain unknown field "${key}"`)
  }
}

function normalizeRunIdentity(run) {
  requireOnlyKeys(run, RUN_KEYS, 'run')
  if (run.schemaVersion !== 1) throw new Error('run.schemaVersion must be 1')
  assertNonEmptyString(run.runId, 'runId')
  if (!RUN_ID.test(run.runId)) throw new Error('runId must be a safe identifier')
  if (!REPOSITORY_KEY.test(run.repositoryKey)) throw new Error('repositoryKey must be a repository identity')
  if (!COMMIT.test(run.baseCommit)) throw new Error('baseCommit must be a Git commit hash')
  if (!HEX64.test(run.configDigest)) throw new Error('configDigest must be a sha256 hex digest')
  if (!HEX64.test(run.workItemDigest)) throw new Error('workItemDigest must be a sha256 hex digest')
  return Object.freeze({
    schemaVersion: 1,
    runId: run.runId,
    repositoryKey: run.repositoryKey,
    baseCommit: run.baseCommit,
    configDigest: run.configDigest,
    workItemDigest: run.workItemDigest,
  })
}

function assertChangedPaths(changedPaths, label) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    throw new Error(`${label} must be a non-empty array of repository-relative paths`)
  }
  for (const path of changedPaths) {
    if (
      typeof path !== 'string' || path.length === 0
      || path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('\0')
    ) {
      throw new Error(`${label} must contain safe repository-relative paths`)
    }
  }
}

const MAKER_KEYS = ['runId', 'artifactId', 'commit', 'parentCommit', 'changedPaths']

function normalizeMaker(maker) {
  requireOnlyKeys(maker, MAKER_KEYS, 'maker')
  assertNonEmptyString(maker.runId, 'maker.runId')
  if (!HEX64.test(maker.artifactId)) throw new Error('maker.artifactId must be a sha256 hex digest')
  if (!COMMIT.test(maker.commit)) throw new Error('maker.commit must be a Git commit hash')
  if (!COMMIT.test(maker.parentCommit)) throw new Error('maker.parentCommit must be a Git commit hash')
  assertChangedPaths(maker.changedPaths, 'maker.changedPaths')
  const normalized = {
    runId: maker.runId,
    artifactId: maker.artifactId,
    commit: maker.commit,
    parentCommit: maker.parentCommit,
    changedPaths: Object.freeze([...maker.changedPaths]),
  }
  return Object.freeze(normalized)
}

const MAKER_RUNTIME_KEYS = ['runtime', 'exitCode', 'outputSha256', 'outputBytes', 'usage']
const USAGE_KEYS = ['model', 'provider', 'apiCalls', 'totalTokens', 'estimatedCostUsd', 'completed', 'failed']

export function assertMakerRuntime(makerRuntime) {
  requireOnlyKeys(makerRuntime, MAKER_RUNTIME_KEYS, 'makerRuntime')
  if (makerRuntime.runtime !== 'hermes') throw new Error('makerRuntime.runtime must be "hermes"')
  if (makerRuntime.exitCode !== 0) throw new Error('makerRuntime.exitCode must be 0')
  if (typeof makerRuntime.outputSha256 !== 'string' || !HEX64.test(makerRuntime.outputSha256)) {
    throw new Error('makerRuntime.outputSha256 must be a lowercase sha256 hex digest')
  }
  if (
    !Number.isSafeInteger(makerRuntime.outputBytes)
    || makerRuntime.outputBytes < 0
    || makerRuntime.outputBytes > MAKER_RUNTIME_BOUNDS.maxOutputBytes
  ) {
    throw new Error(`makerRuntime.outputBytes must be a safe integer between 0 and ${MAKER_RUNTIME_BOUNDS.maxOutputBytes}`)
  }
  const usage = makerRuntime.usage
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
    throw new Error('makerRuntime.usage must be an object')
  }
  requireOnlyKeys(usage, USAGE_KEYS, 'makerRuntime.usage')
  if (typeof usage.model !== 'string' || !SAFE_MAKER_IDENTIFIER.test(usage.model)) {
    throw new Error('makerRuntime.usage.model must be a safe non-empty identifier')
  }
  if (typeof usage.provider !== 'string' || !SAFE_MAKER_IDENTIFIER.test(usage.provider)) {
    throw new Error('makerRuntime.usage.provider must be a safe non-empty identifier')
  }
  if (
    !Number.isSafeInteger(usage.apiCalls)
    || usage.apiCalls < MAKER_RUNTIME_BOUNDS.minApiCalls
    || usage.apiCalls > MAKER_RUNTIME_BOUNDS.maxApiCalls
  ) {
    throw new Error(`makerRuntime.usage.apiCalls must be a safe integer between ${MAKER_RUNTIME_BOUNDS.minApiCalls} and ${MAKER_RUNTIME_BOUNDS.maxApiCalls}`)
  }
  if (
    !Number.isSafeInteger(usage.totalTokens)
    || usage.totalTokens < 0
    || usage.totalTokens > MAKER_RUNTIME_BOUNDS.maxTotalTokens
  ) {
    throw new Error(`makerRuntime.usage.totalTokens must be a safe integer between 0 and ${MAKER_RUNTIME_BOUNDS.maxTotalTokens}`)
  }
  if (
    typeof usage.estimatedCostUsd !== 'number'
    || !Number.isFinite(usage.estimatedCostUsd)
    || usage.estimatedCostUsd < 0
    || usage.estimatedCostUsd > MAKER_RUNTIME_BOUNDS.maxEstimatedCostUsd
  ) {
    throw new Error(`makerRuntime.usage.estimatedCostUsd must be a finite number between 0 and ${MAKER_RUNTIME_BOUNDS.maxEstimatedCostUsd}`)
  }
  if (usage.completed !== true) throw new Error('makerRuntime.usage.completed must be true')
  if (usage.failed !== false) throw new Error('makerRuntime.usage.failed must be false')
  return true
}

function normalizeMakerRuntime(makerRuntime) {
  assertMakerRuntime(makerRuntime)
  const usage = makerRuntime.usage
  return Object.freeze({
    runtime: makerRuntime.runtime,
    exitCode: makerRuntime.exitCode,
    outputSha256: makerRuntime.outputSha256,
    outputBytes: makerRuntime.outputBytes,
    usage: Object.freeze({
      model: usage.model,
      provider: usage.provider,
      apiCalls: usage.apiCalls,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      completed: usage.completed,
      failed: usage.failed,
    }),
  })
}

const VERIFIER_KEYS = ['runId', 'artifactId', 'commit', 'verdict', 'score', 'exitCode']

function normalizeVerifier(verifier) {
  requireOnlyKeys(verifier, VERIFIER_KEYS, 'verifier')
  assertNonEmptyString(verifier.runId, 'verifier.runId')
  if (!HEX64.test(verifier.artifactId)) throw new Error('verifier.artifactId must be a sha256 hex digest')
  if (!COMMIT.test(verifier.commit)) throw new Error('verifier.commit must be a Git commit hash')
  if (verifier.verdict !== 'pass' && verifier.verdict !== 'fail') {
    throw new Error('verifier.verdict must be "pass" or "fail"')
  }
  if (
    typeof verifier.score !== 'number'
    || !Number.isFinite(verifier.score)
    || verifier.score < 0
    || verifier.score > 1
  ) {
    throw new Error('verifier.score must be a finite number between 0 and 1')
  }
  if (!Number.isSafeInteger(verifier.exitCode)) throw new Error('verifier.exitCode must be a safe integer')
  return Object.freeze({
    runId: verifier.runId,
    artifactId: verifier.artifactId,
    commit: verifier.commit,
    verdict: verifier.verdict,
    score: verifier.score,
    exitCode: verifier.exitCode,
  })
}

const OBJECTIVE_GATE_KEYS = ['runId', 'artifactId', 'commit', 'checked', 'passed', 'checks']

function normalizeObjectiveGate(objectiveGate) {
  requireOnlyKeys(objectiveGate, OBJECTIVE_GATE_KEYS, 'objectiveGate')
  assertNonEmptyString(objectiveGate.runId, 'objectiveGate.runId')
  if (!HEX64.test(objectiveGate.artifactId)) throw new Error('objectiveGate.artifactId must be a sha256 hex digest')
  if (!COMMIT.test(objectiveGate.commit)) throw new Error('objectiveGate.commit must be a Git commit hash')
  if (typeof objectiveGate.checked !== 'boolean') throw new Error('objectiveGate.checked must be a boolean')
  if (typeof objectiveGate.passed !== 'boolean') throw new Error('objectiveGate.passed must be a boolean')
  const checks = objectiveGate.checks
  if (checks === null || typeof checks !== 'object' || Array.isArray(checks)) {
    throw new Error('objectiveGate.checks must be an object')
  }
  const checkIds = Object.keys(checks)
  for (const [key, value] of Object.entries(checks)) {
    if (!OBJECTIVE_CHECK_IDS.includes(key)) throw new Error(`objectiveGate.checks has unknown check ID "${key}"`)
    if (typeof value !== 'boolean') throw new Error(`objectiveGate.checks.${key} must be a boolean`)
  }
  for (const checkId of OBJECTIVE_CHECK_IDS) {
    if (!checkIds.includes(checkId)) throw new Error(`objectiveGate.checks is missing required check ID "${checkId}"`)
  }
  if (objectiveGate.passed !== (objectiveGate.checked && Object.values(checks).every(Boolean))) {
    throw new Error('objectiveGate.passed must agree with checked boolean checks')
  }
  return Object.freeze({
    runId: objectiveGate.runId,
    artifactId: objectiveGate.artifactId,
    commit: objectiveGate.commit,
    checked: objectiveGate.checked,
    passed: objectiveGate.passed,
    checks: Object.freeze({ ...checks }),
  })
}

// One run identity, created exactly once. runId is the sole dedup key: creating a run directory
// is an atomic mkdir, so a second call with the same runId always fails closed, identical inputs
// or not — a run is never silently reused.
export function createRunIdentity({ paths, runId, repositoryKey, baseCommit, configDigest, workItemDigest }) {
  const identity = normalizeRunIdentity({
    schemaVersion: 1,
    runId,
    repositoryKey,
    baseCommit,
    configDigest,
    workItemDigest,
  })

  prepareStateDirectory(paths.runs)
  const runDirectory = join(paths.runs, runId)
  try {
    mkdirSync(runDirectory)
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`RUN_ID_ALREADY_USED: ${runId}`)
    throw error
  }
  prepareStateDirectory(runDirectory)
  writeFileSync(
    join(runDirectory, 'state.json'),
    `${JSON.stringify(identity, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  )

  return identity
}

export function assertEvidenceBinding(run, maker, verifier, objectiveGate) {
  for (const [label, artifact] of [['maker', maker], ['verifier', verifier], ['objectiveGate', objectiveGate]]) {
    if (!artifact || artifact.runId !== run.runId) {
      throw new Error(`RUN_ID_MISMATCH: ${label}`)
    }
  }
  if (verifier.artifactId !== maker.artifactId || objectiveGate.artifactId !== maker.artifactId) {
    throw new Error('ARTIFACT_ID_MISMATCH')
  }
  if (verifier.commit !== maker.commit || objectiveGate.commit !== maker.commit) {
    throw new Error('EVIDENCE_COMMIT_MISMATCH')
  }
  if (maker.parentCommit !== run.baseCommit) throw new Error('MAKER_PARENT_MISMATCH')
}

function normalizeEvidenceRecord(record) {
  requireOnlyKeys(record, EVIDENCE_KEYS, 'evidence')
  if (record.schemaVersion !== 2) throw new Error('evidence.schemaVersion must be 2')
  const run = normalizeRunIdentity({
    schemaVersion: 1,
    runId: record.runId,
    repositoryKey: record.repositoryKey,
    baseCommit: record.baseCommit,
    configDigest: record.configDigest,
    workItemDigest: record.workItemDigest,
  })
  const maker = normalizeMaker(record.maker)
  const verifier = normalizeVerifier(record.verifier)
  const objectiveGate = normalizeObjectiveGate(record.objectiveGate)
  const makerRuntime = normalizeMakerRuntime(record.makerRuntime)
  if (record.decision !== 'pass' && record.decision !== 'fail') {
    throw new Error('evidence.decision must be "pass" or "fail"')
  }
  assertEvidenceBinding(run, maker, verifier, objectiveGate)
  if (
    record.decision === 'pass'
    && !(verifier.verdict === 'pass' && objectiveGate.checked && objectiveGate.passed)
  ) {
    throw new Error('DECISION_PASS_REQUIRES_PASSING_VERIFIER_AND_OBJECTIVE_GATE')
  }
  return Object.freeze({
    schemaVersion: 2,
    runId: run.runId,
    repositoryKey: run.repositoryKey,
    baseCommit: run.baseCommit,
    configDigest: run.configDigest,
    workItemDigest: run.workItemDigest,
    maker,
    verifier,
    objectiveGate,
    makerRuntime,
    decision: record.decision,
  })
}

// Read an already-canonical outcome for deterministic recovery. Both immutable files are parsed,
// normalized, reserialized, and matched to the append-only ledger before any queue transition is
// allowed. Recovery therefore cannot infer success from a partial or conflicting write.
export function loadRecordedEvidence({ paths, runId }) {
  if (!RUN_ID.test(runId)) throw new Error('runId must be a safe identifier')
  let runsDescriptor
  let runDescriptor
  let evidenceDescriptor
  let logsDescriptor
  try {
    runsDescriptor = openExistingDirectoryNoFollow(paths.runs)
    runDescriptor = openChildDirectoryNoFollow(runsDescriptor, runId)
    evidenceDescriptor = openExistingDirectoryNoFollow(paths.evidence)
    logsDescriptor = openExistingDirectoryNoFollow(dirname(paths.dispatchLog))

    const stateText = readUtf8RegularFileAt(
      runDescriptor,
      'state.json',
      MAX_EVIDENCE_BYTES,
      'run state',
    )
    let run
    try {
      run = normalizeRunIdentity(JSON.parse(stateText))
    } catch (error) {
      throw new Error(`run state is invalid: ${error.message}`)
    }
    if (run.runId !== runId) throw new Error('RUN_ID_MISMATCH: state')
    if (stateText !== `${JSON.stringify(run, null, 2)}\n`) {
      throw new Error('run state is not canonical')
    }

    const evidenceName = `${runId}.json`
    const serialized = readUtf8RegularFileAt(
      evidenceDescriptor,
      evidenceName,
      MAX_EVIDENCE_BYTES,
      'evidence',
    )
    let record
    try {
      record = normalizeEvidenceRecord(JSON.parse(serialized))
    } catch (error) {
      throw new Error(`evidence is invalid: ${error.message}`)
    }
    if (record.runId !== runId) throw new Error('RUN_ID_MISMATCH: evidence')
    for (const key of ['repositoryKey', 'baseCommit', 'configDigest', 'workItemDigest']) {
      if (record[key] !== run[key]) throw new Error(`RUN_IDENTITY_MISMATCH: ${key}`)
    }
    const canonical = `${JSON.stringify(record, null, 2)}\n`
    if (serialized !== canonical) throw new Error('evidence is not canonical')
    const evidenceDigest = createHash('sha256').update(serialized).digest('hex')
    const ledgerText = readUtf8RegularFileAt(
      logsDescriptor,
      basename(paths.dispatchLog),
      MAX_LEDGER_BYTES,
      'dispatch ledger',
    )
    if (!ledgerContains(paths, runId, evidenceDigest, record, ledgerText)) {
      throw new Error(`LEDGER_ENTRY_MISSING: ${runId}`)
    }
    return Object.freeze({
      run,
      record,
      evidencePath: join(paths.evidence, evidenceName),
      evidenceDigest,
    })
  } finally {
    for (const descriptor of [logsDescriptor, evidenceDescriptor, runDescriptor, runsDescriptor]) {
      if (descriptor !== undefined) closeSync(descriptor)
    }
  }
}

// Bind run + maker + verifier + objective gate into one normalized record, then append it to the
// external, append-only JSONL ledger. Each artifact is validated against its explicit minimal
// schema (unknown fields rejected recursively) so the ledger only ever stores normalized outcomes,
// never raw workspaces, commands, model output, errors, or prompts. The full record is also
// persisted once per run. Exact retries reconcile a missing ledger append idempotently; conflicting
// evidence for the same run remains fail-closed.
export function recordEvidence(
  { paths, run, maker, verifier, objectiveGate, makerRuntime, decision },
  { appendLedger = appendFileSync } = {},
) {
  if (decision !== 'pass' && decision !== 'fail') {
    throw new Error(`decision must be "pass" or "fail", got "${decision}"`)
  }
  const normalizedRun = normalizeRunIdentity(run)
  const normalizedMaker = normalizeMaker(maker)
  const normalizedVerifier = normalizeVerifier(verifier)
  const normalizedObjectiveGate = normalizeObjectiveGate(objectiveGate)
  const normalizedMakerRuntime = normalizeMakerRuntime(makerRuntime)
  assertEvidenceBinding(normalizedRun, normalizedMaker, normalizedVerifier, normalizedObjectiveGate)

  if (
    decision === 'pass'
    && !(
      normalizedVerifier.verdict === 'pass'
      && normalizedObjectiveGate.checked === true
      && normalizedObjectiveGate.passed === true
    )
  ) {
    throw new Error('DECISION_PASS_REQUIRES_PASSING_VERIFIER_AND_OBJECTIVE_GATE')
  }

  const record = Object.freeze({
    schemaVersion: 2,
    runId: normalizedRun.runId,
    repositoryKey: normalizedRun.repositoryKey,
    baseCommit: normalizedRun.baseCommit,
    configDigest: normalizedRun.configDigest,
    workItemDigest: normalizedRun.workItemDigest,
    maker: normalizedMaker,
    verifier: normalizedVerifier,
    objectiveGate: normalizedObjectiveGate,
    makerRuntime: normalizedMakerRuntime,
    decision,
  })

  const serialized = `${JSON.stringify(record, null, 2)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > MAX_EVIDENCE_BYTES) {
    throw new Error('evidence exceeds size limit')
  }
  const evidenceDigest = createHash('sha256').update(serialized).digest('hex')

  const recordingLockPath = reserveEvidenceRecording(paths, normalizedRun.runId)
  try {
    prepareStateDirectory(paths.evidence)
    prepareStateDirectory(dirname(paths.dispatchLog))
    const evidencePath = join(paths.evidence, `${normalizedRun.runId}.json`)
    try {
      writeFileSync(evidencePath, serialized, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const existing = readUtf8RegularFileNoFollow(
        evidencePath,
        MAX_EVIDENCE_BYTES,
        'existing evidence',
      )
      if (existing !== serialized) throw new Error(`EVIDENCE_CONFLICT: ${normalizedRun.runId}`)
    }

    if (!ledgerContains(paths, normalizedRun.runId, evidenceDigest, record)) {
      appendLedger(
        paths.dispatchLog,
        `${JSON.stringify({ ...record, evidenceDigest })}\n`,
        { mode: 0o600 },
      )
    }

    return Object.freeze({ record, evidenceDigest, evidencePath, ledgerPath: paths.dispatchLog })
  } finally {
    rmdirSync(recordingLockPath)
  }
}
