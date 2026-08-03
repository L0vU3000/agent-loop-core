import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  claimWorkItem,
  hashWorkItem,
  reserveClaimDigest,
  reserveInProgress,
  resolveWorkItem,
} from '../src/core/work-items.mjs'
import { createRunIdentity, recordEvidence } from '../src/core/evidence.mjs'
import { deriveRepositoryState } from '../src/paths/repository-state.mjs'

const WORK_ITEM_CONTENT = '---\npipeline: bug-fix\n---\nFix the defect described here. Stay within configured allowed paths.\n'
const REPOSITORY_KEY = 'f'.repeat(24)
const BASE_COMMIT = 'a'.repeat(40)
const CONFIG_DIGEST = createHash('sha256').update('config-fixture').digest('hex')
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

function canonicalMaker({
  runId,
  commit,
  parentCommit = BASE_COMMIT,
  changedPaths = ['src/example.mjs'],
  artifactId = canonicalArtifactId(runId),
}) {
  return {
    runId,
    artifactId,
    commit,
    parentCommit,
    changedPaths,
  }
}

function canonicalVerifier({
  runId,
  commit,
  artifactId = canonicalArtifactId(runId),
  verdict = 'pass',
  score = 1,
  exitCode = 0,
}) {
  return { runId, artifactId, commit, verdict, score, exitCode }
}

function canonicalObjectiveGate({
  runId,
  commit,
  artifactId = canonicalArtifactId(runId),
  checked = true,
  passed = true,
  checks = PASSING_OBJECTIVE_CHECKS,
}) {
  return { runId, artifactId, commit, checked, passed, checks }
}

function canonicalEvidenceArtifacts({ runId, commit }) {
  return {
    maker: canonicalMaker({ runId, commit }),
    verifier: canonicalVerifier({ runId, commit }),
    objectiveGate: canonicalObjectiveGate({ runId, commit }),
  }
}

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-work-items-test-'))
  try {
    return run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

async function waitForPath(pathname) {
  const deadline = Date.now() + 5_000
  while (!existsSync(pathname)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${pathname}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

function runGit(repositoryPath, args) {
  const result = spawnSync('/usr/bin/git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
    env: { HOME: repositoryPath, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function gitStatus(repositoryPath) {
  const result = spawnSync('/usr/bin/git', ['-C', repositoryPath, 'status', '--porcelain'], {
    encoding: 'utf8',
    env: { HOME: repositoryPath, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function fixture(directory) {
  const repositoryPath = join(directory, 'repository')
  mkdirSync(repositoryPath, { recursive: true })
  writeFileSync(join(repositoryPath, 'README.md'), '# fixture\n')
  runGit(repositoryPath, ['init', '--quiet'])
  runGit(repositoryPath, ['add', '.'])
  runGit(repositoryPath, [
    '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '-m', 'fixture',
  ])

  const workItemPath = join(directory, 'work-item.md')
  writeFileSync(workItemPath, WORK_ITEM_CONTENT)

  const state = deriveRepositoryState({
    repositoryPath,
    stateRoot: join(directory, 'state'),
    env: { HOME: directory },
  })

  return { repositoryPath, workItemPath, paths: state.paths }
}

test('claims a bounded work item once: read, hash, place in pending, then atomically reserve in-progress', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)

    const claim = claimWorkItem({ paths, workItemPath })

    assert.equal(claim.content, WORK_ITEM_CONTENT)
    assert.equal(claim.workItemDigest, createHash('sha256').update(WORK_ITEM_CONTENT, 'utf8').digest('hex'))
    assert.equal(claim.claimedPath, join(paths.inProgress, `${claim.workItemDigest}.md`))
    assert.equal(existsSync(claim.claimedPath), true)
    assert.equal(readFileSync(claim.claimedPath, 'utf8'), WORK_ITEM_CONTENT)
    assert.deepEqual(readdirSync(paths.pending), [])
  })
})

test('fails closed when the same work-item digest is already claimed', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)

    claimWorkItem({ paths, workItemPath })

    assert.throws(() => claimWorkItem({ paths, workItemPath }), /WORK_ITEM_ALREADY_CLAIMED/)
  })
})

test('fails closed when a work-item digest already sits in done or failed', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)

    const claim = claimWorkItem({ paths, workItemPath })
    resolveWorkItem({ paths, workItemDigest: claim.workItemDigest, outcome: 'pass' })

    assert.throws(() => claimWorkItem({ paths, workItemPath }), /WORK_ITEM_ALREADY_CLAIMED/)
  })
})

test('reserves the permanent digest marker before consulting legacy queue state', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const content = readFileSync(workItemPath, 'utf8')
    const workItemDigest = hashWorkItem(content)
    mkdirSync(paths.done, { recursive: true })
    writeFileSync(join(paths.done, `${workItemDigest}.md`), content)

    assert.throws(() => claimWorkItem({ paths, workItemPath }), /WORK_ITEM_ALREADY_CLAIMED/)
    assert.equal(existsSync(join(paths.claims, workItemDigest)), true)
  })
})

test('a claimant that reserves in-progress after another actor already completed the same claim fails closed and never replaces it', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const content = readFileSync(workItemPath, 'utf8')
    const workItemDigest = hashWorkItem(content)
    const filename = `${workItemDigest}.md`

    // A normal claimant (B) completes an ordinary claim first.
    const winner = claimWorkItem({ paths, workItemPath })

    // A second claimant (A) had already observed "not claimed" before B ran (a stale read from a
    // real concurrent race) and only now reaches the pending-write step, after B fully claimed it.
    const stalePendingPath = join(paths.pending, filename)
    writeFileSync(stalePendingPath, content, { flag: 'wx', mode: 0o600 })
    const staleClaimedPath = join(paths.inProgress, filename)

    assert.throws(
      () => reserveInProgress({ pendingPath: stalePendingPath, claimedPath: staleClaimedPath, workItemDigest }),
      /WORK_ITEM_ALREADY_CLAIMED/,
    )

    // B's claim must be untouched, not silently replaced by A's losing reservation attempt.
    assert.equal(readFileSync(winner.claimedPath, 'utf8'), content)
    // A's stale pending copy must not linger as further crash residue.
    assert.equal(existsSync(stalePendingPath), false)
  })
})

test('a permanent digest reservation blocks a delayed claimant after the winner resolves', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const winner = claimWorkItem({ paths, workItemPath })
    resolveWorkItem({ paths, workItemDigest: winner.workItemDigest, outcome: 'pass' })

    assert.throws(
      () => reserveClaimDigest({ paths, workItemDigest: winner.workItemDigest }),
      /WORK_ITEM_ALREADY_CLAIMED/,
    )
    assert.equal(existsSync(join(paths.done, `${winner.workItemDigest}.md`)), true)
    assert.equal(existsSync(join(paths.inProgress, `${winner.workItemDigest}.md`)), false)
  })
})

test('a passing outcome moves the claimed item to done', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })

    const resolved = resolveWorkItem({ paths, workItemDigest: claim.workItemDigest, outcome: 'pass' })

    assert.equal(resolved.path, join(paths.done, `${claim.workItemDigest}.md`))
    assert.equal(existsSync(resolved.path), true)
    assert.equal(existsSync(claim.claimedPath), false)
  })
})

test('a failing outcome moves the claimed item to failed', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })

    const resolved = resolveWorkItem({ paths, workItemDigest: claim.workItemDigest, outcome: 'fail' })

    assert.equal(resolved.path, join(paths.failed, `${claim.workItemDigest}.md`))
    assert.equal(existsSync(resolved.path), true)
    assert.equal(existsSync(claim.claimedPath), false)
  })
})

test('concurrent opposite outcomes reserve exactly one canonical terminal decision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-opposite-outcome-test-'))
  try {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const startPath = join(directory, 'start')
    const readyPaths = [join(directory, 'pass-ready'), join(directory, 'fail-ready')]
    const moduleUrl = new URL('../src/core/work-items.mjs', import.meta.url).href
    const childSource = `
      import { existsSync, writeFileSync } from 'node:fs'
      import { resolveWorkItem } from ${JSON.stringify(moduleUrl)}
      const [pathsJson, digest, outcome, readyPath, startPath] = process.argv.slice(1)
      writeFileSync(readyPath, '')
      const waitBuffer = new Int32Array(new SharedArrayBuffer(4))
      while (!existsSync(startPath)) Atomics.wait(waitBuffer, 0, 0, 5)
      try {
        resolveWorkItem({ paths: JSON.parse(pathsJson), workItemDigest: digest, outcome })
        process.stdout.write('resolved')
      } catch (error) {
        process.stderr.write(error.message)
        process.exitCode = 1
      }
    `
    const children = ['pass', 'fail'].map((outcome, index) => spawn(process.execPath, [
      '--input-type=module',
      '-e',
      childSource,
      JSON.stringify(paths),
      claim.workItemDigest,
      outcome,
      readyPaths[index],
      startPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] }))

    await Promise.all(readyPaths.map(waitForPath))
    writeFileSync(startPath, '')
    const results = await Promise.all(children.map(waitForChild))

    assert.deepEqual(results.map((result) => result.code).sort(), [0, 1])
    const rejected = results.find((result) => result.code === 1)
    assert.match(rejected.stderr, /WORK_ITEM_OUTCOME_CONFLICT/)
    assert.equal(existsSync(claim.claimedPath), false)
    const terminalPaths = [
      join(paths.done, `${claim.workItemDigest}.md`),
      join(paths.failed, `${claim.workItemDigest}.md`),
    ]
    assert.equal(terminalPaths.filter(existsSync).length, 1)
    assert.equal(readFileSync(terminalPaths.find(existsSync), 'utf8'), WORK_ITEM_CONTENT)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('resolving fails closed instead of replacing a pre-existing outcome', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const targetPath = join(paths.done, `${claim.workItemDigest}.md`)
    const existing = 'pre-existing canonical outcome\n'
    writeFileSync(targetPath, existing, { flag: 'wx', mode: 0o600 })

    assert.throws(
      () => resolveWorkItem({ paths, workItemDigest: claim.workItemDigest, outcome: 'pass' }),
      /WORK_ITEM_ALREADY_RESOLVED/,
    )
    assert.equal(readFileSync(targetPath, 'utf8'), existing)
    assert.equal(readFileSync(claim.claimedPath, 'utf8'), WORK_ITEM_CONTENT)
  })
})

test('rejects an outcome that is not pass or fail', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })

    assert.throws(
      () => resolveWorkItem({ paths, workItemDigest: claim.workItemDigest, outcome: 'partial' }),
      /outcome must be "pass" or "fail"/,
    )
  })
})

test('rejects a non-digest work-item identifier before resolving a path', () => {
  withTemporaryDirectory((directory) => {
    const { paths } = fixture(directory)

    assert.throws(
      () => resolveWorkItem({ paths, workItemDigest: '../escape', outcome: 'fail' }),
      /workItemDigest must be a sha256 hex digest/,
    )
  })
})

test('an unbounded work item is rejected before it is claimed', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    writeFileSync(workItemPath, 'x'.repeat((64 * 1024) + 1))

    assert.throws(() => claimWorkItem({ paths, workItemPath }), /exceeds size limit/)
  })
})

test('a work item whose frontmatter is not exactly "pipeline: bug-fix" is rejected before any state is created', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    writeFileSync(workItemPath, '---\npipeline: bug-fix\nextra: field\n---\nFix it.\n')

    assert.throws(() => claimWorkItem({ paths, workItemPath }), /pipeline: bug-fix/)
    assert.equal(existsSync(paths.pending), false)
    assert.equal(existsSync(paths.inProgress), false)
  })
})

test('a work item with no frontmatter at all is rejected before any state is created', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    writeFileSync(workItemPath, 'Fix it, no frontmatter here.\n')

    assert.throws(() => claimWorkItem({ paths, workItemPath }), /pipeline: bug-fix/)
    assert.equal(existsSync(paths.pending), false)
    assert.equal(existsSync(paths.inProgress), false)
  })
})

test('a work item with an empty body is rejected before any state is created', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    writeFileSync(workItemPath, '---\npipeline: bug-fix\n---\n   \n')

    assert.throws(() => claimWorkItem({ paths, workItemPath }), /body must not be empty/)
    assert.equal(existsSync(paths.pending), false)
    assert.equal(existsSync(paths.inProgress), false)
  })
})

test('malformed UTF-8 is rejected before hashing or creating state', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    writeFileSync(workItemPath, Buffer.concat([
      Buffer.from('---\npipeline: bug-fix\n---\n'),
      Buffer.from([0xc3, 0x28]),
    ]))

    assert.throws(() => claimWorkItem({ paths, workItemPath }), /valid UTF-8/)
    assert.equal(existsSync(paths.pending), false)
    assert.equal(existsSync(paths.claims), false)
  })
})

test('run identity binds runId, baseCommit, config digest, and work-item digest immutably', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })

    const identity = createRunIdentity({
      paths,
      runId: 'run-001',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })

    assert.deepEqual(identity, {
      schemaVersion: 1,
      runId: 'run-001',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    assert.equal(Object.isFrozen(identity), true)
    assert.throws(() => { identity.runId = 'mutated' }, TypeError)
    assert.equal(
      existsSync(join(paths.runs, 'run-001', 'state.json')),
      true,
    )
  })
})

test('fails closed on a duplicate run ID even with identical inputs', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const identityInput = {
      paths,
      runId: 'run-duplicate',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    }

    createRunIdentity(identityInput)

    assert.throws(() => createRunIdentity(identityInput), /RUN_ID_ALREADY_USED/)
  })
})

test('recording evidence rejects a forged unsafe run identity before constructing paths', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const forgedRun = {
      schemaVersion: 1,
      runId: '../escape',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    }
    const commit = 'a1'.repeat(20)
    const artifacts = canonicalEvidenceArtifacts({ runId: forgedRun.runId, commit })

    assert.throws(
      () => recordEvidence({ paths, run: forgedRun, ...artifacts, decision: 'pass' }),
      /runId must be a safe identifier/,
    )
  })
})

test('evidence binds run, maker artifact, verifier, and objective gate together', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-evidence',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = 'b'.repeat(40)
    const { maker, verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })

    const outcome = recordEvidence({ paths, run, maker, verifier, objectiveGate, decision: 'pass' })

    assert.equal(outcome.record.runId, run.runId)
    assert.equal(outcome.record.decision, 'pass')
    assert.equal(outcome.record.maker.commit, commit)
    assert.equal(outcome.record.verifier.commit, commit)
    assert.equal(outcome.record.objectiveGate.commit, commit)
    assert.equal(existsSync(outcome.evidencePath), true)
    assert.equal(
      outcome.evidenceDigest,
      createHash('sha256').update(readFileSync(outcome.evidencePath, 'utf8')).digest('hex'),
    )
  })
})

test('rejects evidence whose maker/verifier/objective-gate run ID does not match', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-mismatch',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = 'c'.repeat(40)
    const maker = canonicalMaker({ runId: run.runId, commit })
    const verifier = canonicalVerifier({ runId: 'a-different-run', commit })
    const objectiveGate = canonicalObjectiveGate({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({ paths, run, maker, verifier, objectiveGate, decision: 'pass' }),
      /RUN_ID_MISMATCH/,
    )
  })
})

test('rejects evidence whose verifier or objective-gate commit disagrees with the maker commit', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-commit-mismatch',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const maker = canonicalMaker({ runId: run.runId, commit: 'd'.repeat(40) })
    const verifier = canonicalVerifier({ runId: run.runId, commit: 'e'.repeat(40) })
    const objectiveGate = canonicalObjectiveGate({ runId: run.runId, commit: 'd'.repeat(40) })

    assert.throws(
      () => recordEvidence({ paths, run, maker, verifier, objectiveGate, decision: 'pass' }),
      /EVIDENCE_COMMIT_MISMATCH/,
    )
  })
})

test('rejects evidence whose maker parent is not the immutable run base commit', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-parent-mismatch',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = 'd2'.repeat(20)
    const { maker, verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({
        paths,
        run,
        maker: { ...maker, parentCommit: 'e2'.repeat(20) },
        verifier,
        objectiveGate,
        decision: 'pass',
      }),
      /MAKER_PARENT_MISMATCH/,
    )
  })
})

test('the append-only ledger rejects raw model/error output fields', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-raw-output',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = 'f'.repeat(40)
    const maker = {
      ...canonicalMaker({ runId: run.runId, commit }),
      stdout: 'raw model output must never be persisted',
    }
    const verifier = canonicalVerifier({ runId: run.runId, commit })
    const objectiveGate = canonicalObjectiveGate({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({ paths, run, maker, verifier, objectiveGate, decision: 'pass' }),
      /unknown field "stdout"/,
    )
    assert.equal(existsSync(join(paths.evidence, `${run.runId}.json`)), false)
  })
})

test('rejects unknown fields anywhere in maker, verifier, or objective-gate evidence (workspace, command, raw output, errors, prompts)', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-unknown-fields',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '5'.repeat(40)
    const { maker, verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({
        paths, run, decision: 'pass',
        maker: { ...maker, workspace: '/tmp/maker-workspace' },
        verifier,
        objectiveGate,
      }),
      /maker must not contain unknown field "workspace"/,
    )
    assert.throws(
      () => recordEvidence({
        paths, run, decision: 'pass',
        maker,
        verifier: { ...verifier, command: 'node --test' },
        objectiveGate,
      }),
      /verifier must not contain unknown field "command"/,
    )
    assert.throws(
      () => recordEvidence({
        paths, run, decision: 'pass',
        maker,
        verifier,
        objectiveGate: { ...objectiveGate, errors: ['boom'] },
      }),
      /objectiveGate must not contain unknown field "errors"/,
    )
    assert.throws(
      () => recordEvidence({
        paths, run, decision: 'pass',
        maker: { ...maker, prompt: 'you are the maker...' },
        verifier,
        objectiveGate,
      }),
      /maker must not contain unknown field "prompt"/,
    )
    assert.equal(existsSync(join(paths.evidence, `${run.runId}.json`)), false)
  })
})

test('rejects a non-boolean value nested inside the objective-gate checks map', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-checks-not-boolean',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '6'.repeat(40)
    const { maker, verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({
        paths,
        run,
        maker,
        verifier,
        objectiveGate: { ...objectiveGate, checks: { tests: { nested: true } } },
        decision: 'pass',
      }),
      /objectiveGate\.checks\.tests must be a boolean/,
    )
  })
})

test('rejects objective-gate check IDs outside the fixed transaction allowlist', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-unsafe-check-name',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '7'.repeat(40)
    const { maker, verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({
        paths,
        run,
        maker,
        verifier,
        objectiveGate: {
          ...objectiveGate,
          checks: { ...PASSING_OBJECTIVE_CHECKS, arbitraryCheck: true },
        },
        decision: 'pass',
      }),
      /unknown check ID "arbitraryCheck"/,
    )
  })
})

test('requires every fixed objective-gate check ID so passing evidence cannot omit a gate', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-missing-objective-check',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '71'.repeat(20)
    const { maker, verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })
    const incompleteChecks = { ...PASSING_OBJECTIVE_CHECKS }
    delete incompleteChecks.originalClean

    assert.throws(
      () => recordEvidence({
        paths,
        run,
        maker,
        verifier,
        objectiveGate: { ...objectiveGate, checks: incompleteChecks },
        decision: 'pass',
      }),
      /missing required check ID "originalClean"/,
    )
  })
})

test('rejects a maker artifactId that is not a sha256 hex digest', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-bad-artifact-id',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '8'.repeat(40)
    const { verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })
    const maker = canonicalMaker({ runId: run.runId, commit, artifactId: 'not-a-sha256-digest' })

    assert.throws(
      () => recordEvidence({ paths, run, maker, verifier, objectiveGate, decision: 'pass' }),
      /maker\.artifactId must be a sha256 hex digest/,
    )
  })
})

test('rejects a verifier or objective-gate artifactId that does not match the maker artifactId', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-artifact-mismatch',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '9'.repeat(40)
    const { maker, verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })
    const otherArtifactId = createHash('sha256').update('a-different-artifact').digest('hex')

    assert.throws(
      () => recordEvidence({
        paths, run, maker, objectiveGate, decision: 'pass',
        verifier: { ...verifier, artifactId: otherArtifactId },
      }),
      /ARTIFACT_ID_MISMATCH/,
    )
    assert.throws(
      () => recordEvidence({
        paths, run, maker, verifier, decision: 'pass',
        objectiveGate: { ...objectiveGate, artifactId: otherArtifactId },
      }),
      /ARTIFACT_ID_MISMATCH/,
    )
  })
})

test('rejects a maker, verifier, or objective-gate commit that is not a valid Git commit hash', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-invalid-commit',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = 'b1'.repeat(20)
    const { maker, verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({
        paths, run, verifier, objectiveGate, decision: 'pass',
        maker: { ...maker, commit: 'not-a-commit-hash' },
      }),
      /maker\.commit must be a Git commit hash/,
    )
    assert.throws(
      () => recordEvidence({
        paths, run, verifier, objectiveGate, decision: 'pass',
        maker: { ...maker, parentCommit: 'not-a-commit-hash' },
      }),
      /maker\.parentCommit must be a Git commit hash/,
    )
  })
})

test('rejects a pass decision unless the verifier verdict is pass', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-decision-needs-pass-verdict',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = 'c1'.repeat(20)
    const { maker, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })
    const verifier = canonicalVerifier({ runId: run.runId, commit, verdict: 'fail', score: 0 })

    assert.throws(
      () => recordEvidence({ paths, run, maker, verifier, objectiveGate, decision: 'pass' }),
      /DECISION_PASS_REQUIRES_PASSING_VERIFIER_AND_OBJECTIVE_GATE/,
    )
  })
})

test('rejects a pass decision unless the objective gate is both checked and passed', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-decision-needs-objective-gate',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = 'd1'.repeat(20)
    const { maker, verifier } = canonicalEvidenceArtifacts({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({
        paths, run, maker, verifier, decision: 'pass',
        objectiveGate: canonicalObjectiveGate({ runId: run.runId, commit, checked: false, passed: false }),
      }),
      /DECISION_PASS_REQUIRES_PASSING_VERIFIER_AND_OBJECTIVE_GATE/,
    )
    assert.throws(
      () => recordEvidence({
        paths, run, maker, verifier, decision: 'pass',
        objectiveGate: canonicalObjectiveGate({ runId: run.runId, commit, checked: true, passed: false }),
      }),
      /objectiveGate\.passed must agree with checked boolean checks/,
    )
  })
})

test('rejects a pass decision when any normalized objective check is false', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-false-objective-check',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = 'd3'.repeat(20)
    const { maker, verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })

    assert.throws(
      () => recordEvidence({
        paths,
        run,
        maker,
        verifier,
        objectiveGate: {
          ...objectiveGate,
          passed: true,
          checks: { ...PASSING_OBJECTIVE_CHECKS, tests: false },
        },
        decision: 'pass',
      }),
      /objectiveGate\.passed must agree with checked boolean checks/,
    )
  })
})

test('rejects evidence over 256 KiB before creating an evidence file or ledger', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-oversized-evidence',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = 'd4'.repeat(20)
    const { maker, verifier, objectiveGate } = canonicalEvidenceArtifacts({ runId: run.runId, commit })
    const oversizedMaker = {
      ...maker,
      changedPaths: Array.from(
        { length: 5000 },
        (_, index) => `src/generated-${index}-${'a'.repeat(48)}.mjs`,
      ),
    }

    assert.throws(
      () => recordEvidence({
        paths,
        run,
        maker: oversizedMaker,
        verifier,
        objectiveGate,
        decision: 'pass',
      }),
      /evidence exceeds size limit/,
    )
    assert.equal(existsSync(paths.evidence), false)
    assert.equal(existsSync(paths.dispatchLog), false)
  })
})

test('evidence is appended to the JSONL ledger without disturbing prior lines', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const runOne = createRunIdentity({
      paths,
      runId: 'run-ledger-one',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commitOne = '1'.repeat(40)
    recordEvidence({
      paths,
      run: runOne,
      ...canonicalEvidenceArtifacts({ runId: runOne.runId, commit: commitOne }),
      decision: 'pass',
    })

    const secondWorkItemPath = join(directory, 'second-work-item.md')
    writeFileSync(secondWorkItemPath, `${WORK_ITEM_CONTENT}\nSecond.\n`)
    const secondClaim = claimWorkItem({ paths, workItemPath: secondWorkItemPath })
    const runTwo = createRunIdentity({
      paths,
      runId: 'run-ledger-two',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: secondClaim.workItemDigest,
    })
    const commitTwo = '2'.repeat(40)
    recordEvidence({
      paths,
      run: runTwo,
      ...canonicalEvidenceArtifacts({ runId: runTwo.runId, commit: commitTwo }),
      decision: 'fail',
    })

    const lines = readFileSync(paths.dispatchLog, 'utf8').trim().split('\n')
    assert.equal(lines.length, 2)
    const [first, second] = lines.map((line) => JSON.parse(line))
    assert.equal(first.runId, 'run-ledger-one')
    assert.equal(second.runId, 'run-ledger-two')
  })
})

test('evidence recording recovers idempotently after ledger append fails', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-recover-evidence',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '3'.repeat(40)
    const evidenceInput = {
      paths,
      run,
      ...canonicalEvidenceArtifacts({ runId: run.runId, commit }),
      decision: 'pass',
    }

    assert.throws(
      () => recordEvidence(evidenceInput, {
        appendLedger() { throw new Error('injected ledger append failure') },
      }),
      /injected ledger append failure/,
    )
    assert.equal(existsSync(join(paths.evidence, `${run.runId}.json`)), true)
    assert.equal(existsSync(paths.dispatchLog), false)

    const recovered = recordEvidence(evidenceInput)
    const repeated = recordEvidence(evidenceInput)
    assert.equal(recovered.evidenceDigest, repeated.evidenceDigest)
    assert.equal(readFileSync(paths.dispatchLog, 'utf8').trim().split('\n').length, 1)
  })
})

test('concurrent evidence recording cannot append the same run twice', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-concurrent-evidence',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '39'.repeat(20)
    const evidenceInput = {
      paths,
      run,
      ...canonicalEvidenceArtifacts({ runId: run.runId, commit }),
      decision: 'pass',
    }

    recordEvidence(evidenceInput, {
      appendLedger(ledgerPath, line, options) {
        assert.throws(
          () => recordEvidence(evidenceInput),
          /EVIDENCE_RECORDING_IN_PROGRESS/,
        )
        appendFileSync(ledgerPath, line, options)
      },
    })

    assert.equal(readFileSync(paths.dispatchLog, 'utf8').trim().split('\n').length, 1)
  })
})

test('conflicting evidence for an existing run ID fails closed', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-conflicting-evidence',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '3a'.repeat(20)
    const evidenceInput = {
      paths,
      run,
      ...canonicalEvidenceArtifacts({ runId: run.runId, commit }),
      decision: 'pass',
    }
    recordEvidence(evidenceInput)

    assert.throws(
      () => recordEvidence({
        ...evidenceInput,
        verifier: { ...evidenceInput.verifier, score: 0.5 },
      }),
      /EVIDENCE_CONFLICT/,
    )
  })
})

test('state-root symlink swaps are rejected before the target can be mutated', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath, repositoryPath } = fixture(directory)
    const stateRoot = dirname(dirname(paths.pending))
    symlinkSync(repositoryPath, stateRoot, 'dir')

    assert.throws(() => claimWorkItem({ paths, workItemPath }), /state path must not contain symbolic links/)
    assert.equal(gitStatus(repositoryPath), '')
    assert.equal(existsSync(join(repositoryPath, 'inbox')), false)
  })
})

test('evidence-directory symlink swaps are rejected before the target can be mutated', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath, repositoryPath } = fixture(directory)
    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-symlink-evidence',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '4a'.repeat(20)
    symlinkSync(repositoryPath, paths.evidence, 'dir')

    assert.throws(
      () => recordEvidence({
        paths,
        run,
        ...canonicalEvidenceArtifacts({ runId: run.runId, commit }),
        decision: 'pass',
      }),
      /state path must not contain symbolic links/,
    )
    assert.equal(existsSync(join(repositoryPath, `${run.runId}.json`)), false)
    assert.equal(gitStatus(repositoryPath), '')
  })
})

test('claim, resolve, and evidence recording never dirty the target repository', () => {
  withTemporaryDirectory((directory) => {
    const { paths, workItemPath, repositoryPath } = fixture(directory)
    assert.equal(gitStatus(repositoryPath), '')

    const claim = claimWorkItem({ paths, workItemPath })
    const run = createRunIdentity({
      paths,
      runId: 'run-clean-target',
      repositoryKey: REPOSITORY_KEY,
      baseCommit: BASE_COMMIT,
      configDigest: CONFIG_DIGEST,
      workItemDigest: claim.workItemDigest,
    })
    const commit = '4'.repeat(40)
    recordEvidence({
      paths,
      run,
      ...canonicalEvidenceArtifacts({ runId: run.runId, commit }),
      decision: 'pass',
    })
    resolveWorkItem({ paths, workItemDigest: claim.workItemDigest, outcome: 'pass' })

    assert.equal(gitStatus(repositoryPath), '')
  })
})
