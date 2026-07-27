import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  copyControlPlaneFixture,
  createBrokenRepository,
  writeBugItem,
} from '../lib/fixture.mjs'
import { assertEvidenceBinding, runRealGitTransaction } from '../lib/run-transaction.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const AGENT_LOOP_ROOT = resolve(HERE, '../../..')

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

test('runs one canonical claim-to-record transaction through separate maker and verifier worktrees', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-spike-002-'))
  const previousSecret = process.env.SPIKE_SECRET_SENTINEL
  process.env.SPIKE_SECRET_SENTINEL = 'must-not-cross-runtime-boundary'
  try {
    const controlPlaneRoot = join(root, 'agent-loop')
    const repositoryRoot = join(root, 'fixture-repository')
    const workspaceRoot = join(root, 'runtime-workspaces')
    copyControlPlaneFixture(AGENT_LOOP_ROOT, controlPlaneRoot)
    writeBugItem(controlPlaneRoot)
    const baseCommit = createBrokenRepository(repositoryRoot)

    const result = await runRealGitTransaction({
      agentLoopRoot: controlPlaneRoot,
      repositoryRoot,
      workspaceRoot,
      runId: 'run-spike-002-001',
      rubric: {
        sha256: 'a'.repeat(64),
        passThreshold: 1,
      },
    })

    assert.equal(result.run.schemaVersion, 1)
    assert.equal(result.run.runId, 'run-spike-002-001')
    assert.equal(result.run.file, '10-fix-add.md')
    assert.equal(result.run.pipeline, 'bug-fix')
    assert.equal(result.run.baseCommit, baseCommit)
    assert.match(result.run.workItemSha256, /^[a-f0-9]{64}$/)

    assert.equal(result.preflight.verdict, 'fail', 'the base commit must reproduce the defect')
    assert.notEqual(result.maker.workspace, result.verification.workspace)
    assert.equal(result.maker.parentCommit, baseCommit)
    assert.match(result.maker.commit, /^[a-f0-9]{40}$/)
    assert.equal(result.verification.commit, result.maker.commit)
    assert.equal(result.verification.artifactId, result.maker.artifactId)
    assert.equal(result.verification.verdict, 'pass')
    assert.equal(result.objectiveGate.checked, true)
    assert.equal(result.objectiveGate.passed, true)
    assert.equal(result.objectiveGate.commit, result.maker.commit)
    assert.equal(result.record.outcome, 'pass')
    assert.equal(result.record.moved, 'inbox/done/10-fix-add.md')
    assert.match(result.record.evidenceSha256, /^[a-f0-9]{64}$/)
    assert.equal(result.record.evidencePath, 'orchestrator/evidence/run-spike-002-001.json')

    const evidence = JSON.parse(readFileSync(join(controlPlaneRoot, result.record.evidencePath), 'utf8'))
    assert.equal(evidence.run.runId, result.run.runId)
    assert.equal(evidence.maker.artifactId, result.maker.artifactId)
    assert.equal(evidence.verification.commit, result.maker.commit)
    assert.equal(evidence.objectiveGate.commit, result.maker.commit)
    assert.equal(evidence.decision, 'pass')

    assert.equal(git(result.maker.workspace, 'status', '--porcelain'), '')
    assert.equal(git(result.verification.workspace, 'status', '--porcelain'), '')
    assert.equal(git(result.verification.workspace, 'rev-parse', 'HEAD'), result.maker.commit)
    assert.ok(existsSync(join(controlPlaneRoot, 'orchestrator', 'inbox', 'done', '10-fix-add.md')))
    const dispatchLog = readFileSync(join(controlPlaneRoot, 'orchestrator', 'dispatch-log.md'), 'utf8')
    assert.match(dispatchLog, /10-fix-add\.md -> pass/)
    assert.match(dispatchLog, /git transaction: verifier=pass, objective-gate=pass/)
    assert.doesNotMatch(dispatchLog, /eve adapter/)
    assert.ok(Object.isFrozen(result.run), 'run identity must be immutable')
  } finally {
    if (previousSecret === undefined) delete process.env.SPIKE_SECRET_SENTINEL
    else process.env.SPIKE_SECRET_SENTINEL = previousSecret
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects verifier and gate evidence that is not bound to the exact maker artifact', () => {
  const run = { runId: 'run-immutable-001' }
  const maker = { runId: run.runId, artifactId: 'artifact-a', commit: 'a'.repeat(40) }
  const verification = { ...maker }
  const objectiveGate = { ...maker }

  assert.doesNotThrow(() => assertEvidenceBinding(run, maker, verification, objectiveGate))
  assert.throws(
    () => assertEvidenceBinding(run, maker, { ...verification, commit: 'b'.repeat(40) }, objectiveGate),
    /EVIDENCE_COMMIT_MISMATCH/,
  )
  assert.throws(
    () => assertEvidenceBinding(run, maker, { ...verification, artifactId: 'artifact-b' }, objectiveGate),
    /ARTIFACT_ID_MISMATCH/,
  )
  assert.throws(
    () => assertEvidenceBinding(run, maker, { ...verification, runId: 'different-run' }, objectiveGate),
    /RUN_ID_MISMATCH/,
  )
  assert.throws(
    () => assertEvidenceBinding(run, maker, verification, { ...objectiveGate, runId: 'different-run' }),
    /RUN_ID_MISMATCH/,
  )
  assert.throws(
    () => assertEvidenceBinding(run, maker, verification, { ...objectiveGate, artifactId: 'artifact-b' }),
    /ARTIFACT_ID_MISMATCH/,
  )
  assert.throws(
    () => assertEvidenceBinding(run, maker, verification, { ...objectiveGate, commit: 'b'.repeat(40) }),
    /EVIDENCE_COMMIT_MISMATCH/,
  )
})

test('records fail when a passing objective test dirties the verifier worktree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-spike-002-dirty-gate-'))
  try {
    const controlPlaneRoot = join(root, 'agent-loop')
    const repositoryRoot = join(root, 'fixture-repository')
    const workspaceRoot = join(root, 'runtime-workspaces')
    copyControlPlaneFixture(AGENT_LOOP_ROOT, controlPlaneRoot)
    writeBugItem(controlPlaneRoot)
    createBrokenRepository(repositoryRoot, { dirtyOnObjective: true })

    const result = await runRealGitTransaction({
      agentLoopRoot: controlPlaneRoot,
      repositoryRoot,
      workspaceRoot,
      runId: 'run-spike-002-dirty-gate',
      rubric: { sha256: 'b'.repeat(64), passThreshold: 1 },
    })

    assert.equal(result.verification.verdict, 'pass')
    assert.equal(result.objectiveGate.checks.tests, true)
    assert.equal(result.objectiveGate.checks.clean, false)
    assert.equal(result.objectiveGate.passed, false)
    assert.equal(result.record.outcome, 'fail')
    assert.ok(existsSync(join(controlPlaneRoot, 'orchestrator', 'inbox', 'failed', '10-fix-add.md')))
    assert.match(git(result.verification.workspace, 'status', '--porcelain'), /post-objective-test\.txt/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ignores repository-controlled global Git config and commit hooks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-spike-002-hostile-git-'))
  try {
    const controlPlaneRoot = join(root, 'agent-loop')
    const repositoryRoot = join(root, 'fixture-repository')
    const workspaceRoot = join(root, 'runtime-workspaces')
    copyControlPlaneFixture(AGENT_LOOP_ROOT, controlPlaneRoot)
    writeBugItem(controlPlaneRoot)
    createBrokenRepository(repositoryRoot, { hostileGitConfig: true })

    const result = await runRealGitTransaction({
      agentLoopRoot: controlPlaneRoot,
      repositoryRoot,
      workspaceRoot,
      runId: 'run-spike-002-hostile-git',
      rubric: { sha256: 'c'.repeat(64), passThreshold: 1 },
    })

    assert.equal(result.record.outcome, 'pass')
    assert.equal(existsSync(join(result.maker.workspace, 'hook-ran.txt')), false)
    assert.equal(git(result.maker.workspace, 'status', '--porcelain'), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('records an unexpected failure and removes registered worktrees and the maker branch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-spike-002-cleanup-'))
  try {
    const controlPlaneRoot = join(root, 'agent-loop')
    const repositoryRoot = join(root, 'fixture-repository')
    const workspaceRoot = join(root, 'runtime-workspaces')
    const runId = 'run-spike-002-cleanup'
    copyControlPlaneFixture(AGENT_LOOP_ROOT, controlPlaneRoot)
    writeBugItem(controlPlaneRoot)
    createBrokenRepository(repositoryRoot, { missingExpectedDefect: true })

    await assert.rejects(() => runRealGitTransaction({
      agentLoopRoot: controlPlaneRoot,
      repositoryRoot,
      workspaceRoot,
      runId,
      rubric: { sha256: 'd'.repeat(64), passThreshold: 1 },
    }), /fixture defect was not found/)

    assert.ok(existsSync(join(controlPlaneRoot, 'orchestrator', 'inbox', 'failed', '10-fix-add.md')))
    assert.ok(existsSync(join(controlPlaneRoot, 'orchestrator', 'evidence', `${runId}.failure.json`)))
    assert.equal(existsSync(join(workspaceRoot, 'maker')), false)
    assert.equal(existsSync(join(workspaceRoot, 'verifier')), false)
    assert.equal(git(repositoryRoot, 'branch', '--list', `agent-loop/${runId}-maker`), '')
    assert.doesNotMatch(git(repositoryRoot, 'worktree', 'list', '--porcelain'), /runtime-workspaces/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fixture setup ignores inherited global Git config and hooks', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-spike-002-fixture-git-'))
  const previousHome = process.env.HOME
  try {
    const fakeHome = join(root, 'home')
    const hookDirectory = join(root, 'global-hooks')
    const marker = join(root, 'global-hook-ran.txt')
    mkdirSync(fakeHome, { recursive: true })
    mkdirSync(hookDirectory, { recursive: true })
    writeFileSync(join(fakeHome, '.gitconfig'), `[core]\n\thooksPath = ${hookDirectory}\n`)
    const hook = join(hookDirectory, 'pre-commit')
    writeFileSync(hook, `#!/bin/sh\nprintf 'ran\\n' > '${marker}'\n`)
    chmodSync(hook, 0o755)
    process.env.HOME = fakeHome

    createBrokenRepository(join(root, 'fixture-repository'))

    assert.equal(existsSync(marker), false)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects any nested transaction roots before claiming an item', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-spike-002-overlap-'))
  try {
    const controlPlaneRoot = join(root, 'agent-loop')
    const repositoryRoot = join(controlPlaneRoot, 'nested-repository')
    const workspaceRoot = join(root, 'runtime-workspaces')
    copyControlPlaneFixture(AGENT_LOOP_ROOT, controlPlaneRoot)
    writeBugItem(controlPlaneRoot)
    createBrokenRepository(repositoryRoot)

    await assert.rejects(() => runRealGitTransaction({
      agentLoopRoot: controlPlaneRoot,
      repositoryRoot,
      workspaceRoot,
      runId: 'run-spike-002-overlap',
      rubric: { sha256: 'e'.repeat(64), passThreshold: 1 },
    }), /roots must not overlap/)

    assert.ok(existsSync(join(controlPlaneRoot, 'orchestrator', 'inbox', '10-fix-add.md')))
    assert.equal(existsSync(join(controlPlaneRoot, 'orchestrator', 'inbox', 'in-progress', '10-fix-add.md')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('canonicalizes symlink aliases before checking root overlap', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-spike-002-symlink-overlap-'))
  try {
    const realControlPlaneRoot = join(root, 'real-agent-loop')
    const aliasedControlPlaneRoot = join(root, 'agent-loop-alias')
    const repositoryRoot = join(realControlPlaneRoot, 'nested-repository')
    const workspaceRoot = join(root, 'runtime-workspaces')
    copyControlPlaneFixture(AGENT_LOOP_ROOT, realControlPlaneRoot)
    writeBugItem(realControlPlaneRoot)
    createBrokenRepository(repositoryRoot)
    symlinkSync(realControlPlaneRoot, aliasedControlPlaneRoot, 'dir')

    await assert.rejects(() => runRealGitTransaction({
      agentLoopRoot: aliasedControlPlaneRoot,
      repositoryRoot,
      workspaceRoot,
      runId: 'run-spike-002-symlink-overlap',
      rubric: { sha256: 'f'.repeat(64), passThreshold: 1 },
    }), /roots must not overlap/)

    assert.ok(existsSync(join(realControlPlaneRoot, 'orchestrator', 'inbox', '10-fix-add.md')))
    assert.equal(existsSync(join(realControlPlaneRoot, 'orchestrator', 'inbox', 'in-progress', '10-fix-add.md')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('treats the filesystem root as an ancestor during overlap validation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-spike-002-filesystem-root-'))
  try {
    const repositoryRoot = join(root, 'fixture-repository')
    const workspaceRoot = join(root, 'runtime-workspaces')
    createBrokenRepository(repositoryRoot)

    await assert.rejects(() => runRealGitTransaction({
      agentLoopRoot: '/',
      repositoryRoot,
      workspaceRoot,
      runId: 'run-spike-002-filesystem-root',
      rubric: { sha256: '1'.repeat(64), passThreshold: 1 },
    }), /roots must not overlap/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
