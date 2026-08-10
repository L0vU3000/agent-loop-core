import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { createRunIdentity, loadRecordedEvidence, recordEvidence } from '../src/core/evidence.mjs'
import { claimWorkItem } from '../src/core/work-items.mjs'
import { deriveRepositoryState } from '../src/paths/repository-state.mjs'
import { canonicalMakerRuntime } from './helpers.mjs'

const REPOSITORY_KEY = 'f'.repeat(24)
const BASE_COMMIT = 'a'.repeat(40)
const CONFIG_DIGEST = createHash('sha256').update('config-evidence-v2').digest('hex')
const PASSING_OBJECTIVE_CHECKS = Object.freeze({
  exactHead: true,
  clean: true,
  originalHead: true,
  originalClean: true,
  tests: true,
})

function canonicalArtifactId(runId) {
  return createHash('sha256').update(`${runId}-maker-artifact`).digest('hex')
}

function canonicalMaker({ runId, commit, parentCommit = BASE_COMMIT, changedPaths = ['src/example.mjs'], artifactId = canonicalArtifactId(runId) }) {
  return { runId, artifactId, commit, parentCommit, changedPaths }
}

function canonicalVerifier({ runId, commit, artifactId = canonicalArtifactId(runId), verdict = 'pass', score = 1, exitCode = 0 }) {
  return { runId, artifactId, commit, verdict, score, exitCode }
}

function canonicalObjectiveGate({ runId, commit, artifactId = canonicalArtifactId(runId), checked = true, passed = true, checks = PASSING_OBJECTIVE_CHECKS }) {
  return { runId, artifactId, commit, checked, passed, checks }
}

function canonicalArtifacts({ runId, commit, makerRuntime = canonicalMakerRuntime() }) {
  return {
    maker: canonicalMaker({ runId, commit }),
    verifier: canonicalVerifier({ runId, commit }),
    objectiveGate: canonicalObjectiveGate({ runId, commit }),
    makerRuntime,
  }
}

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-evidence-v2-test-'))
  try {
    return run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function fixture(directory) {
  const repositoryPath = join(directory, 'repository')
  mkdirSync(repositoryPath, { recursive: true })
  writeFileSync(join(repositoryPath, 'README.md'), '# fixture\n')
  execFileSync('/usr/bin/git', ['-C', repositoryPath, 'init', '--quiet'])
  execFileSync('/usr/bin/git', ['-C', repositoryPath, 'add', '.'])
  execFileSync('/usr/bin/git', [
    '-C', repositoryPath,
    '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '-m', 'fixture',
  ])
  const state = deriveRepositoryState({ repositoryPath, stateRoot: join(directory, 'state'), env: { HOME: directory } })
  const workItemPath = join(directory, 'work-item.md')
  writeFileSync(workItemPath, '---\npipeline: bug-fix\n---\nEvidence v2 fixture.\n')
  const claim = claimWorkItem({ paths: state.paths, workItemPath })
  return { repositoryPath, state, claim }
}

function createRun(directory, runId, claim) {
  return createRunIdentity({
    paths: directory.state.paths,
    runId,
    repositoryKey: REPOSITORY_KEY,
    baseCommit: BASE_COMMIT,
    configDigest: CONFIG_DIGEST,
    workItemDigest: claim.workItemDigest,
  })
}

test('recorded evidence is schemaVersion 2 and contains exact normalized runtime provenance', () => {
  withTemporaryDirectory((directory) => {
    const { state, claim } = fixture(directory)
    const run = createRun({ state }, 'run-schema-v2', claim)
    const commit = 'b'.repeat(40)
    const runtime = canonicalMakerRuntime({
      outputSha256: createHash('sha256').update('exact output\n').digest('hex'),
      outputBytes: 13,
      usage: {
        model: 'claude-sonnet-5',
        provider: 'anthropic',
        apiCalls: 2,
        totalTokens: 150,
        estimatedCostUsd: 0.05,
        completed: true,
        failed: false,
      },
    })

    const outcome = recordEvidence({
      paths: state.paths,
      run,
      ...canonicalArtifacts({ runId: run.runId, commit, makerRuntime: runtime }),
      decision: 'pass',
    })

    assert.equal(outcome.record.schemaVersion, 2)
    assert.deepEqual(outcome.record.makerRuntime, {
      runtime: 'hermes',
      exitCode: 0,
      outputSha256: createHash('sha256').update('exact output\n').digest('hex'),
      outputBytes: 13,
      usage: {
        model: 'claude-sonnet-5',
        provider: 'anthropic',
        apiCalls: 2,
        totalTokens: 150,
        estimatedCostUsd: 0.05,
        completed: true,
        failed: false,
      },
    })
    assert.equal(outcome.record.makerRuntime.runtime, 'hermes')
    assert.equal(outcome.record.makerRuntime.exitCode, 0)
    assert.equal(outcome.record.makerRuntime.outputSha256, createHash('sha256').update('exact output\n').digest('hex'))
    assert.equal(outcome.record.makerRuntime.outputBytes, 13)
    assert.equal(outcome.record.makerRuntime.usage.model, 'claude-sonnet-5')
    assert.equal(outcome.record.makerRuntime.usage.provider, 'anthropic')
    assert.equal(outcome.record.makerRuntime.usage.apiCalls, 2)
    assert.equal(outcome.record.makerRuntime.usage.totalTokens, 150)
    assert.equal(outcome.record.makerRuntime.usage.estimatedCostUsd, 0.05)
    assert.equal(outcome.record.makerRuntime.usage.completed, true)
    assert.equal(outcome.record.makerRuntime.usage.failed, false)

    const onDisk = JSON.parse(readFileSync(outcome.evidencePath, 'utf8'))
    assert.equal(onDisk.schemaVersion, 2)
    assert.deepEqual(onDisk.makerRuntime, outcome.record.makerRuntime)
    assert.equal(onDisk.makerRuntime.stdout, undefined)
    assert.equal(onDisk.makerRuntime.stderr, undefined)
    assert.equal(onDisk.makerRuntime.output, undefined)
    assert.equal(onDisk.makerRuntime.usage.prompt, undefined)
    assert.equal(onDisk.makerRuntime.usage.command, undefined)
  })
})

test('loadRecordedEvidence rejects schemaVersion 1 and unsupported evidence versions', () => {
  withTemporaryDirectory((directory) => {
    const { state, claim } = fixture(directory)
    const run = createRun({ state }, 'run-schema-v1', claim)
    const commit = 'c'.repeat(40)
    const { maker, verifier, objectiveGate } = canonicalArtifacts({ runId: run.runId, commit })

    const v1Record = {
      schemaVersion: 1,
      runId: run.runId,
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: run.workItemDigest,
      maker,
      verifier,
      objectiveGate,
      decision: 'pass',
    }
    const runDirectory = join(state.paths.runs, run.runId)
    mkdirSync(runDirectory, { recursive: true })
    writeFileSync(join(runDirectory, 'state.json'), `${JSON.stringify(run, null, 2)}\n`)
    mkdirSync(state.paths.evidence, { recursive: true })
    const evidencePath = join(state.paths.evidence, `${run.runId}.json`)
    writeFileSync(evidencePath, `${JSON.stringify(v1Record, null, 2)}\n`)
    mkdirSync(dirname(state.paths.dispatchLog), { recursive: true })

    assert.throws(
      () => loadRecordedEvidence({ paths: state.paths, runId: run.runId }),
      /evidence\.schemaVersion must be 2/,
    )

    const v3Record = { ...v1Record, schemaVersion: 3, makerRuntime: canonicalMakerRuntime() }
    writeFileSync(evidencePath, `${JSON.stringify(v3Record, null, 2)}\n`)
    assert.throws(
      () => loadRecordedEvidence({ paths: state.paths, runId: run.runId }),
      /evidence\.schemaVersion must be 2/,
    )
  })
})

test('makerRuntime rejects non-hermes runtime, nonzero exit, malformed hash, and missing usage', () => {
  withTemporaryDirectory((directory) => {
    const { state, claim } = fixture(directory)
    const run = createRun({ state }, 'run-runtime-semantics', claim)
    const commit = 'd'.repeat(40)
    const base = canonicalArtifacts({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: { ...base.makerRuntime, runtime: 'openai' }, decision: 'pass' }),
      /makerRuntime\.runtime must be \"hermes\"/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: { ...base.makerRuntime, exitCode: 1 }, decision: 'pass' }),
      /makerRuntime\.exitCode must be 0/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: { ...base.makerRuntime, outputSha256: 'UPPERCASEBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBADBAD' }, decision: 'pass' }),
      /makerRuntime\.outputSha256 must be a lowercase sha256 hex digest/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: { runtime: 'hermes', exitCode: 0, outputSha256: base.makerRuntime.outputSha256, outputBytes: 0 }, decision: 'pass' }),
      /makerRuntime\.usage must be an object/,
    )
  })
})

test('makerRuntime rejects unsafe identifiers and invalid bounds in usage', () => {
  withTemporaryDirectory((directory) => {
    const { state, claim } = fixture(directory)
    const run = createRun({ state }, 'run-usage-bounds', claim)
    const commit = 'e'.repeat(40)
    const base = canonicalArtifacts({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: canonicalMakerRuntime({ usage: { model: '' } }), decision: 'pass' }),
      /makerRuntime\.usage\.model must be a safe non-empty identifier/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: canonicalMakerRuntime({ usage: { provider: '../../escape' } }), decision: 'pass' }),
      /makerRuntime\.usage\.provider must be a safe non-empty identifier/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: canonicalMakerRuntime({ usage: { apiCalls: -1 } }), decision: 'pass' }),
      /makerRuntime\.usage\.apiCalls must be a safe integer/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: canonicalMakerRuntime({ usage: { apiCalls: 0 } }), decision: 'pass' }),
      /makerRuntime\.usage\.apiCalls must be a safe integer between 1 and/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: canonicalMakerRuntime({ usage: { totalTokens: Number.MAX_SAFE_INTEGER + 1 } }), decision: 'pass' }),
      /makerRuntime\.usage\.totalTokens must be a safe integer/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: canonicalMakerRuntime({ usage: { estimatedCostUsd: NaN } }), decision: 'pass' }),
      /makerRuntime\.usage\.estimatedCostUsd must be a finite number/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: canonicalMakerRuntime({ usage: { estimatedCostUsd: 2_000_000 } }), decision: 'pass' }),
      /makerRuntime\.usage\.estimatedCostUsd must be a finite number/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: { ...base.makerRuntime, outputBytes: -1 }, decision: 'pass' }),
      /makerRuntime\.outputBytes must be a safe integer/,
    )
  })
})

test('makerRuntime rejects completed false and failed true for persisted canonical evidence', () => {
  withTemporaryDirectory((directory) => {
    const { state, claim } = fixture(directory)
    const run = createRun({ state }, 'run-completed-failed', claim)
    const commit = 'f'.repeat(40)
    const base = canonicalArtifacts({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: canonicalMakerRuntime({ usage: { completed: false } }), decision: 'pass' }),
      /makerRuntime\.usage\.completed must be true/,
    )
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: canonicalMakerRuntime({ usage: { failed: true } }), decision: 'pass' }),
      /makerRuntime\.usage\.failed must be false/,
    )
  })
})

test('makerRuntime rejects unknown and raw fields at both levels', () => {
  withTemporaryDirectory((directory) => {
    const { state, claim } = fixture(directory)
    const run = createRun({ state }, 'run-raw-runtime-fields', claim)
    const commit = '0'.repeat(40)
    const base = canonicalArtifacts({ runId: run.runId, commit })

    const topLevelUnknowns = [
      'stdout', 'stderr', 'output', 'prompt', 'command', 'cwd', 'path', 'error',
    ]
    for (const field of topLevelUnknowns) {
      assert.throws(
        () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: { ...base.makerRuntime, [field]: 'leak' }, decision: 'pass' }),
        new RegExp(`makerRuntime must not contain unknown field "${field}"`),
        `expected rejection for top-level ${field}`,
      )
    }
    assert.throws(
      () => recordEvidence({ paths: state.paths, run, ...base, makerRuntime: { ...base.makerRuntime, usage: { ...base.makerRuntime.usage, rawOutput: 'leak' } }, decision: 'pass' }),
      /makerRuntime\.usage must not contain unknown field "rawOutput"/,
    )
  })
})

test('changing only makerRuntime changes the evidence digest and conflicts fail closed for the same run', () => {
  withTemporaryDirectory((directory) => {
    const { state, claim } = fixture(directory)
    const run = createRun({ state }, 'run-runtime-conflict', claim)
    const commit = '1'.repeat(40)
    const firstRuntime = canonicalMakerRuntime({ outputBytes: 100 })
    const secondRuntime = canonicalMakerRuntime({ outputBytes: 101 })

    const first = recordEvidence({
      paths: state.paths,
      run,
      ...canonicalArtifacts({ runId: run.runId, commit, makerRuntime: firstRuntime }),
      decision: 'pass',
    })

    assert.throws(
      () => recordEvidence({
        paths: state.paths,
        run,
        ...canonicalArtifacts({ runId: run.runId, commit, makerRuntime: secondRuntime }),
        decision: 'pass',
      }),
      /EVIDENCE_CONFLICT/,
    )

    // A different run with the second runtime produces a different digest.
    const runTwo = createRun({ state }, 'run-runtime-conflict-two', claim)
    const second = recordEvidence({
      paths: state.paths,
      run: runTwo,
      ...canonicalArtifacts({ runId: runTwo.runId, commit, makerRuntime: secondRuntime }),
      decision: 'pass',
    })
    assert.notEqual(second.evidenceDigest, first.evidenceDigest)
  })
})

test('ledger idempotence covers makerRuntime and rejects conflicting ledger rows', () => {
  withTemporaryDirectory((directory) => {
    const { state, claim } = fixture(directory)
    const run = createRun({ state }, 'run-ledger-runtime', claim)
    const commit = '2'.repeat(40)
    const runtime = canonicalMakerRuntime({ usage: { apiCalls: 7 } })
    const input = {
      paths: state.paths,
      run,
      ...canonicalArtifacts({ runId: run.runId, commit, makerRuntime: runtime }),
      decision: 'pass',
    }

    const first = recordEvidence(input)
    const second = recordEvidence(input)
    assert.equal(first.evidenceDigest, second.evidenceDigest)

    const ledgerText = readFileSync(state.paths.dispatchLog, 'utf8')
    const ledgerRow = JSON.parse(ledgerText.trim())
    assert.equal(ledgerRow.schemaVersion, 2)
    assert.equal(ledgerRow.makerRuntime.usage.apiCalls, 7)
    assert.equal(ledgerRow.makerRuntime.usage.completed, true)

    const tamperedLedger = ledgerText.replace('"apiCalls":7', '"apiCalls":8')
    writeFileSync(state.paths.dispatchLog, tamperedLedger)
    assert.throws(
      () => recordEvidence(input),
      /LEDGER_CONFLICT/,
    )
  })
})
