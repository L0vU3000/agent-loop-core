import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  assertRootsDisjoint,
  deriveRepositoryState,
} from '../src/paths/repository-state.mjs'

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-state-test-'))
  try {
    return run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function initializeRepository(repositoryPath) {
  mkdirSync(repositoryPath, { recursive: true })
  const result = spawnSync('/usr/bin/git', ['init', '--quiet', repositoryPath], {
    encoding: 'utf8',
    env: {
      HOME: repositoryPath,
      PATH: '/usr/bin:/bin',
      LANG: 'C.UTF-8',
    },
  })
  assert.equal(result.status, 0, result.stderr)
}

function runGit(repositoryPath, args) {
  const result = spawnSync('/usr/bin/git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
    env: {
      HOME: repositoryPath,
      PATH: '/usr/bin:/bin',
      LANG: 'C.UTF-8',
    },
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

test('canonical repository aliases derive the same external state identity without creating it', () => {
  withTemporaryDirectory((directory) => {
    const repositoryPath = join(directory, 'repository')
    const repositoryAlias = join(directory, 'repository-alias')
    const xdgStateHome = join(directory, 'state-home')
    initializeRepository(repositoryPath)
    symlinkSync(repositoryPath, repositoryAlias, 'dir')

    const direct = deriveRepositoryState({
      repositoryPath,
      env: { XDG_STATE_HOME: xdgStateHome, HOME: directory },
    })
    const alias = deriveRepositoryState({
      repositoryPath: repositoryAlias,
      env: { XDG_STATE_HOME: xdgStateHome, HOME: directory },
    })

    assert.equal(direct.repositoryRoot, realpathSync(repositoryPath))
    assert.equal(direct.repositoryKey, alias.repositoryKey)
    assert.match(direct.repositoryKey, /^[a-f0-9]{24}$/)
    assert.equal(
      direct.stateRoot,
      join(xdgStateHome, 'agent-loop', 'repositories', direct.repositoryKey),
    )
    assert.equal(existsSync(direct.stateRoot), false)
  })
})

test('separate repositories receive separate complete external state layouts', () => {
  withTemporaryDirectory((directory) => {
    const firstRepository = join(directory, 'first-repository')
    const secondRepository = join(directory, 'second-repository')
    const xdgStateHome = join(directory, 'state-home')
    initializeRepository(firstRepository)
    initializeRepository(secondRepository)

    const first = deriveRepositoryState({
      repositoryPath: firstRepository,
      env: { XDG_STATE_HOME: xdgStateHome, HOME: directory },
    })
    const second = deriveRepositoryState({
      repositoryPath: secondRepository,
      env: { XDG_STATE_HOME: xdgStateHome, HOME: directory },
    })

    assert.notEqual(first.repositoryKey, second.repositoryKey)
    assert.notEqual(first.stateRoot, second.stateRoot)
    assert.deepEqual(first.paths, {
      pending: join(first.stateRoot, 'inbox', 'pending'),
      inProgress: join(first.stateRoot, 'inbox', 'in-progress'),
      done: join(first.stateRoot, 'inbox', 'done'),
      failed: join(first.stateRoot, 'inbox', 'failed'),
      claims: join(first.stateRoot, 'claims'),
      runs: join(first.stateRoot, 'runs'),
      evidence: join(first.stateRoot, 'evidence'),
      dispatchLog: join(first.stateRoot, 'logs', 'dispatch.jsonl'),
      worktrees: join(first.stateRoot, 'worktrees'),
    })
    assert.equal(Object.isFrozen(first.paths), true)
  })
})

test('rejects equal, nested, ancestor, and symlink-overlapping state roots before creation', () => {
  withTemporaryDirectory((directory) => {
    const repositoryPath = join(directory, 'repository')
    const repositoryAlias = join(directory, 'repository-alias')
    initializeRepository(repositoryPath)
    symlinkSync(repositoryPath, repositoryAlias, 'dir')

    const invalidStateRoots = [
      repositoryPath,
      join(repositoryPath, 'state-does-not-exist'),
      directory,
      join(repositoryAlias, 'aliased-state-does-not-exist'),
    ]

    for (const stateRoot of invalidStateRoots) {
      assert.throws(
        () => deriveRepositoryState({
          repositoryPath,
          stateRoot,
          env: { HOME: directory },
        }),
        /state root must not overlap the target repository/,
      )
    }

    assert.throws(
      () => assertRootsDisjoint(repositoryPath, join(repositoryPath, 'another-state')),
      /state root must not overlap the target repository/,
    )
    assert.equal(existsSync(join(repositoryPath, 'state-does-not-exist')), false)
    assert.equal(existsSync(join(repositoryPath, 'another-state')), false)
  })
})

test('HOME fallback state can be created without dirtying the target checkout', () => {
  withTemporaryDirectory((directory) => {
    const repositoryPath = join(directory, 'repository')
    const home = join(directory, 'home')
    initializeRepository(repositoryPath)

    const state = deriveRepositoryState({ repositoryPath, env: { HOME: home } })
    assert.equal(
      state.stateRoot,
      join(home, '.local', 'state', 'agent-loop', 'repositories', state.repositoryKey),
    )
    mkdirSync(state.paths.pending, { recursive: true })

    const status = spawnSync('/usr/bin/git', ['-C', repositoryPath, 'status', '--porcelain'], {
      encoding: 'utf8',
      env: { HOME: home, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
    })
    assert.equal(status.status, 0, status.stderr)
    assert.equal(status.stdout, '')
    assert.throws(
      () => deriveRepositoryState({ repositoryPath, stateRoot: 'relative/state', env: { HOME: home } }),
      /stateRoot must be absolute/,
    )
  })
})

test('rejects state roots overlapping a linked worktree shared Git directory', () => {
  withTemporaryDirectory((directory) => {
    const mainRepository = join(directory, 'main-repository')
    const linkedWorktree = join(directory, 'linked-worktree')
    initializeRepository(mainRepository)
    writeFileSync(join(mainRepository, 'README.md'), '# fixture\n')
    runGit(mainRepository, ['add', 'README.md'])
    runGit(mainRepository, [
      '-c', 'user.name=Fixture',
      '-c', 'user.email=fixture@example.invalid',
      'commit', '--quiet', '-m', 'fixture',
    ])
    runGit(mainRepository, ['worktree', 'add', '--quiet', '--detach', linkedWorktree])

    const sharedGitDirectory = realpathSync(join(mainRepository, '.git'))
    assert.throws(
      () => deriveRepositoryState({
        repositoryPath: linkedWorktree,
        stateRoot: join(sharedGitDirectory, 'agent-loop-state'),
        env: { HOME: directory },
      }),
      /state root must not overlap Git metadata/,
    )
  })
})
