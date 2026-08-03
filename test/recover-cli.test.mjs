import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { runAgentLoopRecover } from '../src/cli/recover.mjs'
import { createRunIdentity, recordEvidence } from '../src/core/evidence.mjs'
import { claimWorkItem } from '../src/core/work-items.mjs'
import { deriveRepositoryState } from '../src/paths/repository-state.mjs'

const WORK_ITEM = '---\npipeline: bug-fix\n---\nRepair the bounded defect.\n'
const CONFIG_DIGEST = createHash('sha256').update('config').digest('hex')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'bin', 'agent-loop.mjs')

function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false',
    '-c', 'commit.gpgSign=false',
    '-C', cwd,
    ...args,
  ], {
    encoding: 'utf8',
    env: { HOME: cwd, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  }).trim()
}

function initRepository(repositoryPath) {
  mkdirSync(repositoryPath)
  writeFileSync(join(repositoryPath, 'README.md'), '# fixture\n')
  git(repositoryPath, 'init', '--quiet')
  git(repositoryPath, 'add', '.')
  git(repositoryPath, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture')
}

function fixture(directory) {
  const repositoryPath = join(directory, 'repository')
  initRepository(repositoryPath)

  const stateRoot = join(directory, 'state')
  const state = deriveRepositoryState({ repositoryPath, stateRoot, env: { HOME: directory } })
  const workItemPath = join(directory, 'work-item.md')
  writeFileSync(workItemPath, WORK_ITEM)
  const claim = claimWorkItem({ paths: state.paths, workItemPath })
  const run = createRunIdentity({
    paths: state.paths,
    runId: 'recover-run',
    repositoryKey: state.repositoryKey,
    baseCommit: git(repositoryPath, 'rev-parse', 'HEAD'),
    configDigest: CONFIG_DIGEST,
    workItemDigest: claim.workItemDigest,
  })
  const commit = 'b'.repeat(40)
  const artifactId = createHash('sha256').update('artifact').digest('hex')
  const maker = {
    runId: run.runId,
    artifactId,
    commit,
    parentCommit: run.baseCommit,
    changedPaths: ['src/example.mjs'],
  }
  const verifier = {
    runId: run.runId,
    artifactId,
    commit,
    verdict: 'pass',
    score: 1,
    exitCode: 0,
  }
  const objectiveGate = {
    runId: run.runId,
    artifactId,
    commit,
    checked: true,
    passed: true,
    checks: {
      exactHead: true,
      clean: true,
      originalHead: true,
      originalClean: true,
      tests: true,
    },
  }
  const evidence = recordEvidence({
    paths: state.paths,
    run,
    maker,
    verifier,
    objectiveGate,
    decision: 'pass',
  })
  return { repositoryPath, stateRoot, state, claim, run, evidence }
}

test('fails closed when the in-progress work item content no longer matches the immutable digest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-recover-test-'))
  try {
    const { repositoryPath, stateRoot, claim, run } = fixture(directory)
    writeFileSync(claim.claimedPath, '---\npipeline: bug-fix\n---\nTampered work item.\n')

    const recovered = runAgentLoopRecover({ repo: repositoryPath, stateRoot, runId: run.runId })

    assert.equal(recovered.exitCode, 3)
    assert.deepEqual(recovered.json, {
      schemaVersion: 1,
      error: 'WORK_ITEM_RECOVERY_FAILED',
    })
    assert.equal(existsSync(claim.claimedPath), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('unknown run recovery does not create or reserve state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-recover-test-'))
  try {
    const { repositoryPath, stateRoot, state } = fixture(directory)
    const unknownRunDirectory = join(state.paths.runs, 'run-unknown')

    const recovered = runAgentLoopRecover({
      repo: repositoryPath,
      stateRoot,
      runId: 'run-unknown',
    })

    assert.equal(recovered.exitCode, 3)
    assert.equal(existsSync(unknownRunDirectory), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('recovery rejects a different repository paired with another repository state root', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-recover-test-'))
  try {
    const { stateRoot, claim, run } = fixture(directory)
    const otherRepository = join(directory, 'other-repository')
    initRepository(otherRepository)

    const recovered = runAgentLoopRecover({
      repo: otherRepository,
      stateRoot,
      runId: run.runId,
    })

    assert.equal(recovered.exitCode, 3)
    assert.equal(existsSync(claim.claimedPath), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('recovery rejects an opposite durable outcome reservation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-recover-test-'))
  try {
    const { repositoryPath, stateRoot, claim, run } = fixture(directory)
    writeFileSync(
      join(claim.claimMarkerPath, 'outcome.json'),
      `${JSON.stringify({ schemaVersion: 1, workItemDigest: claim.workItemDigest, outcome: 'fail' }, null, 2)}\n`,
    )

    const recovered = runAgentLoopRecover({ repo: repositoryPath, stateRoot, runId: run.runId })

    assert.equal(recovered.exitCode, 3)
    assert.equal(existsSync(claim.claimedPath), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('recovery rejects an independently created same-content terminal copy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-recover-test-'))
  try {
    const { repositoryPath, stateRoot, state, claim, run } = fixture(directory)
    mkdirSync(state.paths.done, { recursive: true })
    writeFileSync(join(state.paths.done, `${claim.workItemDigest}.md`), WORK_ITEM)

    const recovered = runAgentLoopRecover({ repo: repositoryPath, stateRoot, runId: run.runId })

    assert.equal(recovered.exitCode, 3)
    assert.equal(existsSync(claim.claimedPath), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('fails closed when the evidence directory is replaced by a symbolic link', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-recover-test-'))
  try {
    const { repositoryPath, stateRoot, state, claim, run, evidence } = fixture(directory)
    const externalEvidence = join(directory, 'external-evidence')
    mkdirSync(externalEvidence)
    const serialized = readFileSync(evidence.evidencePath)
    rmSync(state.paths.evidence, { recursive: true })
    writeFileSync(join(externalEvidence, `${run.runId}.json`), serialized)
    symlinkSync(externalEvidence, state.paths.evidence)

    const recovered = runAgentLoopRecover({ repo: repositoryPath, stateRoot, runId: run.runId })

    assert.equal(recovered.exitCode, 3)
    assert.deepEqual(recovered.json, {
      schemaVersion: 1,
      error: 'RECORDED_EVIDENCE_UNAVAILABLE',
    })
    assert.equal(existsSync(claim.claimedPath), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('fails closed when the ledger row conflicts with canonical evidence despite reusing its digest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-recover-test-'))
  try {
    const { repositoryPath, stateRoot, state, claim, run } = fixture(directory)
    const [ledgerRow] = readFileSync(state.paths.dispatchLog, 'utf8').trim().split('\n').map(JSON.parse)
    writeFileSync(state.paths.dispatchLog, `${JSON.stringify({ ...ledgerRow, decision: 'fail' })}\n`)

    const recovered = runAgentLoopRecover({ repo: repositoryPath, stateRoot, runId: run.runId })

    assert.equal(recovered.exitCode, 3)
    assert.deepEqual(recovered.json, {
      schemaVersion: 1,
      error: 'RECORDED_EVIDENCE_UNAVAILABLE',
    })
    assert.equal(existsSync(claim.claimedPath), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('recovers hard-link crash residue between terminal reservation and in-progress cleanup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-recover-test-'))
  try {
    const { repositoryPath, stateRoot, state, claim, run } = fixture(directory)
    mkdirSync(state.paths.done, { recursive: true })
    const completedPath = join(state.paths.done, `${claim.workItemDigest}.md`)
    linkSync(claim.claimedPath, completedPath)

    const recovered = runAgentLoopRecover({ repo: repositoryPath, stateRoot, runId: run.runId })

    assert.equal(recovered.exitCode, 0)
    assert.equal(existsSync(claim.claimedPath), false)
    assert.equal(readFileSync(completedPath, 'utf8'), WORK_ITEM)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('recovers evidence-persisted claim resolution without another maker call and reconciles an exact retry', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-recover-test-'))
  try {
    const { repositoryPath, stateRoot, state, claim, run, evidence } = fixture(directory)

    assert.equal(existsSync(claim.claimedPath), true)
    const first = runAgentLoopRecover({ repo: repositoryPath, stateRoot, runId: run.runId })

    assert.equal(first.exitCode, 0)
    assert.deepEqual(first.json, {
      schemaVersion: 1,
      runId: run.runId,
      decision: 'pass',
      evidencePath: evidence.evidencePath,
      evidenceDigest: evidence.evidenceDigest,
      stateRoot,
      recovered: true,
    })
    assert.equal(existsSync(claim.claimedPath), false)
    const completedPath = join(state.paths.done, `${claim.workItemDigest}.md`)
    assert.equal(readFileSync(completedPath, 'utf8'), WORK_ITEM)

    const retry = runAgentLoopRecover({ repo: repositoryPath, stateRoot, runId: run.runId })
    assert.deepEqual(retry, first)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the recover CLI completes the evidence-persisted transition without maker acknowledgment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-recover-test-'))
  try {
    const { repositoryPath, stateRoot, claim, run } = fixture(directory)
    const result = spawnSync(process.execPath, [
      CLI,
      'recover',
      '--repo', repositoryPath,
      '--state-root', stateRoot,
      '--run-id', run.runId,
      '--json',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { HOME: directory, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.runId, run.runId)
    assert.equal(report.recovered, true)
    assert.equal(existsSync(claim.claimedPath), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
