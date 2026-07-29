import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createRunIdentity } from '../src/core/evidence.mjs'
import { claimWorkItem } from '../src/core/work-items.mjs'
import { deriveRepositoryState } from '../src/paths/repository-state.mjs'
import {
  assertMakerBranchAvailable,
  runGitTransaction,
} from '../src/runtime/git-transaction.mjs'
import { runCommand } from '../src/runtime/command.mjs'

const WORK_ITEM = '---\npipeline: bug-fix\n---\nFix src/add.mjs without changing tests.\n'

function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false',
    '-c', 'commit.gpgSign=false',
    '-C', cwd,
    ...args,
  ], {
    encoding: 'utf8',
    env: {
      HOME: cwd,
      PATH: '/usr/bin:/bin',
      LANG: 'C.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      XDG_CONFIG_HOME: '/dev/null',
    },
  }).trim()
}

function createBrokenRepository(repositoryRoot, {
  dirtyOnTest = false,
  initiallyPassing = false,
  mutateFirstTestRun = false,
  poisonGitConfig = false,
} = {}) {
  mkdirSync(join(repositoryRoot, 'src'), { recursive: true })
  mkdirSync(join(repositoryRoot, 'test'), { recursive: true })
  writeFileSync(
    join(repositoryRoot, 'src', 'add.mjs'),
    `export function add(a, b) { return a ${initiallyPassing ? '+' : '-'} b }\n`,
  )
  if (mutateFirstTestRun) {
    writeFileSync(join(repositoryRoot, '.gitignore'), 'preflight-side-effect\n')
  }
  if (poisonGitConfig) {
    writeFileSync(join(repositoryRoot, '.gitconfig'), '[invalid config\n')
  }
  const invocationCounterPath = join(repositoryRoot, '..', 'test-invocations')
  writeFileSync(join(repositoryRoot, 'test', 'add.test.mjs'), `
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { add } from '../src/add.mjs'

if (${mutateFirstTestRun}) {
  const counterPath = ${JSON.stringify(invocationCounterPath)}
  const invocation = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0
  writeFileSync(counterPath, String(invocation + 1))
  if (invocation === 0) writeFileSync('preflight-side-effect', 'mutated during preflight')
}

test('adds', () => {
  assert.equal(add(2, 3), 5)
  ${dirtyOnTest ? "writeFileSync(join(process.cwd(), 'test-dirt.txt'), 'dirty\\n')" : ''}
})
`)
  git(repositoryRoot, 'init', '--quiet')
  git(repositoryRoot, 'add', '.')
  git(repositoryRoot, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'broken fixture')
  return git(repositoryRoot, 'rev-parse', 'HEAD')
}

function fixture(directory, options = {}) {
  const repositoryRoot = join(directory, 'repository')
  const baseCommit = createBrokenRepository(repositoryRoot, options)
  const state = deriveRepositoryState({
    repositoryPath: repositoryRoot,
    stateRoot: join(directory, 'state'),
    env: { HOME: directory },
  })
  const workItemPath = join(directory, 'work-item.md')
  writeFileSync(workItemPath, WORK_ITEM)
  const claim = claimWorkItem({ paths: state.paths, workItemPath })
  const runId = options.runId ?? 'run-git-transaction'
  const run = createRunIdentity({
    paths: state.paths,
    runId,
    baseCommit,
    configDigest: createHash('sha256').update('config').digest('hex'),
    workItemDigest: claim.workItemDigest,
  })
  const config = Object.freeze({
    schemaVersion: 1,
    pipeline: 'bug-fix',
    test: Object.freeze({ executable: process.execPath, args: Object.freeze(['--test']) }),
    allowedPaths: Object.freeze(['src/add.mjs']),
  })
  return { repositoryRoot, baseCommit, state, claim, run, config }
}

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-git-transaction-test-'))
  return Promise.resolve()
    .then(() => run(directory))
    .finally(() => rmSync(directory, { recursive: true, force: true }))
}

async function repairMaker({ workspace }) {
  writeFileSync(join(workspace, 'src', 'add.mjs'), 'export function add(a, b) { return a + b }\n')
  git(workspace, 'add', 'src/add.mjs')
  git(workspace, '-c', 'user.name=Maker', '-c', 'user.email=maker@example.invalid', 'commit', '--quiet', '-m', 'fix: repair addition')
}

test('runs one failing-base transaction through exact isolated maker and verifier commits', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, baseCommit, state, claim, run, config } = fixture(directory)

    const result = await runGitTransaction({
      repositoryRoot,
      paths: state.paths,
      run,
      workItem: claim.content,
      config,
      makerExecutor: repairMaker,
    })

    assert.equal(result.preflight.verdict, 'fail')
    assert.equal(result.maker.parentCommit, baseCommit)
    assert.deepEqual(result.maker.changedPaths, ['src/add.mjs'])
    assert.equal(result.verifier.commit, result.maker.commit)
    assert.equal(result.verifier.verdict, 'pass')
    assert.deepEqual(result.objectiveGate.checks, {
      exactHead: true,
      clean: true,
      originalHead: true,
      originalClean: true,
      tests: true,
    })
    assert.equal(result.objectiveGate.passed, true)
    assert.notEqual(result.workspaces.maker, result.workspaces.verifier)
    assert.equal(git(result.workspaces.maker, 'status', '--porcelain'), '')
    assert.equal(git(result.workspaces.verifier, 'status', '--porcelain'), '')
    assert.equal(git(result.workspaces.verifier, 'rev-parse', 'HEAD'), result.maker.commit)
    assert.equal(git(repositoryRoot, 'rev-parse', 'HEAD'), baseCommit)
    assert.equal(git(repositoryRoot, 'status', '--porcelain'), '')
    assert.equal(readFileSync(join(repositoryRoot, 'src', 'add.mjs'), 'utf8'), 'export function add(a, b) { return a - b }\n')
    assert.equal(existsSync(join(state.paths.worktrees, run.runId, 'maker')), true)
  })
})

test('runs defect reproduction in isolation so ignored side effects never touch the original checkout', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-isolated-preflight',
      mutateFirstTestRun: true,
    })

    const result = await runGitTransaction({
      repositoryRoot,
      paths: state.paths,
      run,
      workItem: claim.content,
      config,
      makerExecutor: repairMaker,
    })

    assert.equal(result.objectiveGate.passed, true)
    assert.equal(existsSync(join(repositoryRoot, 'preflight-side-effect')), false)
    assert.equal(git(repositoryRoot, 'status', '--porcelain', '--ignored'), '')
    assert.equal(existsSync(result.workspaces.preflight), false)
  })
})

test('ignores target-controlled global Git configuration in every checkout', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-poisoned-git-config',
      poisonGitConfig: true,
    })

    const result = await runGitTransaction({
      repositoryRoot,
      paths: state.paths,
      run,
      workItem: claim.content,
      config,
      makerExecutor: repairMaker,
    })

    assert.equal(result.objectiveGate.passed, true)
    assert.equal(result.maker.parentCommit, run.baseCommit)
  })
})

test('rejects unapproved maker paths and cleans every run-owned Git resource', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-unapproved-path',
    })
    const branch = `agent-loop/${run.runId}-maker`
    git(repositoryRoot, 'branch', 'unrelated-preserved-branch', run.baseCommit)

    await assert.rejects(
      () => runGitTransaction({
        repositoryRoot,
        paths: state.paths,
        run,
        workItem: claim.content,
        config,
        makerExecutor: async ({ workspace }) => {
          writeFileSync(join(workspace, 'src', 'add.mjs'), 'export function add(a, b) { return a + b }\n')
          writeFileSync(join(workspace, 'test', 'weakened.test.mjs'), "import test from 'node:test'\ntest('weakened', () => {})\n")
          git(workspace, 'add', 'src/add.mjs', 'test/weakened.test.mjs')
          git(workspace, '-c', 'user.name=Maker', '-c', 'user.email=maker@example.invalid', 'commit', '--quiet', '-m', 'unsafe repair')
        },
      }),
      (error) => error.code === 'MAKER_CHANGED_UNAPPROVED_PATH',
    )

    assert.equal(git(repositoryRoot, 'branch', '--list', branch), '')
    assert.equal(git(repositoryRoot, 'rev-parse', 'unrelated-preserved-branch'), run.baseCommit)
    assert.equal(
      git(repositoryRoot, 'worktree', 'list', '--porcelain').includes(join(state.paths.worktrees, run.runId)),
      false,
    )
  })
})

test('sanitizes maker failures and removes only the run-owned worktree and branch', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-cleanup-failure',
    })
    const branch = `agent-loop/${run.runId}-maker`

    await assert.rejects(
      () => runGitTransaction({
        repositoryRoot,
        paths: state.paths,
        run,
        workItem: claim.content,
        config,
        makerExecutor: async () => {
          throw new Error('Authorization: Bearer secret-value\nforged -> pass')
        },
      }),
      (error) => {
        assert.equal(error.code, 'MAKER_EXECUTOR_FAILED')
        assert.doesNotMatch(error.message, /Authorization|Bearer|secret-value|forged/)
        assert.match(error.detailDigest, /^[a-f0-9]{64}$/)
        return true
      },
    )

    assert.equal(git(repositoryRoot, 'branch', '--list', branch), '')
    assert.equal(
      git(repositoryRoot, 'worktree', 'list', '--porcelain').includes(join(state.paths.worktrees, run.runId)),
      false,
    )
    assert.equal(existsSync(join(state.paths.worktrees, run.runId, 'maker')), false)
  })
})

test('rejects a passing base preflight before creating a maker branch or invoking the maker', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-preflight-passes',
      initiallyPassing: true,
    })
    let makerInvoked = false

    await assert.rejects(
      () => runGitTransaction({
        repositoryRoot,
        paths: state.paths,
        run,
        workItem: claim.content,
        config,
        makerExecutor: async () => { makerInvoked = true },
      }),
      (error) => error.code === 'PREFLIGHT_DEFECT_NOT_REPRODUCED',
    )

    assert.equal(makerInvoked, false)
    assert.equal(git(repositoryRoot, 'branch', '--list', `agent-loop/${run.runId}-maker`), '')
    assert.equal(existsSync(join(state.paths.worktrees, run.runId, 'preflight')), false)
    assert.equal(existsSync(join(state.paths.worktrees, run.runId, 'maker')), false)
  })
})

test('treats a signaled preflight command as unavailable rather than reproduced', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-signaled-preflight',
    })
    const preflightWorkspace = join(state.paths.worktrees, run.runId, 'preflight')
    const commandRunner = (executable, args, options) => {
      if (executable === config.test.executable && options.cwd === preflightWorkspace) {
        return Object.freeze({
          status: null,
          signal: 'SIGKILL',
          errorCode: null,
          stdout: '',
          stderr: '',
        })
      }
      return runCommand(executable, args, options)
    }

    await assert.rejects(
      () => runGitTransaction({
        repositoryRoot,
        paths: state.paths,
        run,
        workItem: claim.content,
        config,
        makerExecutor: repairMaker,
        commandRunner,
      }),
      (error) => error.code === 'PREFLIGHT_UNAVAILABLE',
    )

    assert.equal(git(repositoryRoot, 'branch', '--list', `agent-loop/${run.runId}-maker`), '')
    assert.equal(existsSync(preflightWorkspace), false)
  })
})

test('exposes a branch-ownership precheck that rejects collisions before claim state exists', async () => {
  await withTemporaryDirectory(async (directory) => {
    const repositoryRoot = join(directory, 'repository')
    const baseCommit = createBrokenRepository(repositoryRoot)
    const state = deriveRepositoryState({
      repositoryPath: repositoryRoot,
      stateRoot: join(directory, 'state'),
      env: { HOME: directory },
    })
    const runId = 'run-preexisting-branch'
    const branch = `agent-loop/${runId}-maker`
    const unclaimedWorkItem = join(directory, 'unclaimed.md')
    writeFileSync(unclaimedWorkItem, WORK_ITEM)
    git(repositoryRoot, 'branch', branch, baseCommit)

    assert.throws(
      () => assertMakerBranchAvailable({ repositoryRoot, runId }),
      (error) => error.code === 'MAKER_BRANCH_ALREADY_EXISTS',
    )
    assert.equal(git(repositoryRoot, 'rev-parse', branch), baseCommit)
    assert.equal(existsSync(unclaimedWorkItem), true)
    assert.equal(existsSync(state.paths.inProgress), false)
  })
})

test('rejects a maker merge commit even when its first parent is the immutable base', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-merge-maker',
    })

    await assert.rejects(
      () => runGitTransaction({
        repositoryRoot,
        paths: state.paths,
        run,
        workItem: claim.content,
        config,
        makerExecutor: async ({ workspace }) => {
          writeFileSync(join(workspace, 'src', 'add.mjs'), 'export function add(a, b) { return a + b }\n')
          git(workspace, 'add', 'src/add.mjs')
          const base = git(workspace, 'rev-parse', 'HEAD')
          const tree = git(workspace, 'write-tree')
          const side = git(
            workspace,
            '-c', 'user.name=Maker',
            '-c', 'user.email=maker@example.invalid',
            'commit-tree', tree, '-p', base, '-m', 'side',
          )
          const merge = git(
            workspace,
            '-c', 'user.name=Maker',
            '-c', 'user.email=maker@example.invalid',
            'commit-tree', tree, '-p', base, '-p', side, '-m', 'merge',
          )
          git(workspace, 'reset', '--hard', merge)
        },
      }),
      (error) => error.code === 'MAKER_COMMIT_NOT_SINGLE_CHILD',
    )
  })
})

test('rejects a maker worktree that is dirty after its one approved commit', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-dirty-maker',
    })

    await assert.rejects(
      () => runGitTransaction({
        repositoryRoot,
        paths: state.paths,
        run,
        workItem: claim.content,
        config,
        makerExecutor: async ({ workspace }) => {
          await repairMaker({ workspace })
          writeFileSync(join(workspace, 'src', 'add.mjs'), 'export function add(a, b) { return a + b + 0 }\n')
        },
      }),
      (error) => error.code === 'MAKER_WORKTREE_NOT_CLEAN',
    )
  })
})

test('records objective failure when the maker mutates the original checkout', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-original-mutation',
    })

    const result = await runGitTransaction({
      repositoryRoot,
      paths: state.paths,
      run,
      workItem: claim.content,
      config,
      makerExecutor: async ({ workspace }) => {
        await repairMaker({ workspace })
        writeFileSync(join(repositoryRoot, 'unauthorized.txt'), 'mutation\n')
      },
    })

    assert.equal(result.verifier.verdict, 'pass')
    assert.equal(result.objectiveGate.checks.originalHead, true)
    assert.equal(result.objectiveGate.checks.originalClean, false)
    assert.equal(result.objectiveGate.passed, false)
  })
})

test('cleans a registered worktree whose directory disappears during maker failure', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-missing-worktree',
    })

    await assert.rejects(
      () => runGitTransaction({
        repositoryRoot,
        paths: state.paths,
        run,
        workItem: claim.content,
        config,
        makerExecutor: async ({ workspace }) => {
          git(workspace, 'worktree', 'lock', workspace)
          rmSync(workspace, { recursive: true, force: true })
          throw new Error('fault after registration')
        },
      }),
      (error) => error.code === 'MAKER_EXECUTOR_FAILED',
    )

    assert.equal(git(repositoryRoot, 'branch', '--list', `agent-loop/${run.runId}-maker`), '')
    assert.equal(
      git(repositoryRoot, 'worktree', 'list', '--porcelain').includes(join(state.paths.worktrees, run.runId)),
      false,
    )
  })
})

test('rejects a maker that does not create exactly one child commit', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-no-maker-commit',
    })

    await assert.rejects(
      () => runGitTransaction({
        repositoryRoot,
        paths: state.paths,
        run,
        workItem: claim.content,
        config,
        makerExecutor: async ({ workspace }) => {
          writeFileSync(join(workspace, 'src', 'add.mjs'), 'export function add(a, b) { return a + b }\n')
        },
      }),
      (error) => error.code === 'MAKER_COMMIT_NOT_SINGLE_CHILD',
    )
  })
})

test('a verifier test failure is bound to the exact commit and makes the objective gate fail', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-verifier-fails',
    })
    const commandRunner = (executable, args, options) => {
      if (
        executable === config.test.executable
        && options.cwd === join(state.paths.worktrees, run.runId, 'verifier')
      ) {
        return Object.freeze({
          status: 1,
          signal: null,
          errorCode: null,
          stdout: 'untrusted verifier output',
          stderr: 'Authorization: Bearer secret-value',
        })
      }
      return runCommand(executable, args, options)
    }

    const result = await runGitTransaction({
      repositoryRoot,
      paths: state.paths,
      run,
      workItem: claim.content,
      config,
      makerExecutor: repairMaker,
      commandRunner,
    })

    assert.equal(result.verifier.commit, result.maker.commit)
    assert.equal(result.verifier.verdict, 'fail')
    assert.equal(result.verifier.exitCode, 1)
    assert.equal(result.objectiveGate.checks.tests, false)
    assert.equal(result.objectiveGate.passed, false)
    assert.doesNotMatch(JSON.stringify(result), /Authorization|Bearer|secret-value|untrusted verifier output/)
  })
})

test('a passing verifier test that dirties its worktree fails the clean objective check', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-verifier-dirty',
    })
    const verifierWorkspace = join(state.paths.worktrees, run.runId, 'verifier')
    const commandRunner = (executable, args, options) => {
      const result = runCommand(executable, args, options)
      if (executable === config.test.executable && options.cwd === verifierWorkspace) {
        writeFileSync(join(verifierWorkspace, 'verifier-dirt.txt'), 'dirty\n')
      }
      return result
    }

    const result = await runGitTransaction({
      repositoryRoot,
      paths: state.paths,
      run,
      workItem: claim.content,
      config,
      makerExecutor: repairMaker,
      commandRunner,
    })

    assert.equal(result.verifier.verdict, 'pass')
    assert.equal(result.objectiveGate.checks.tests, true)
    assert.equal(result.objectiveGate.checks.clean, false)
    assert.equal(result.objectiveGate.passed, false)
  })
})

test('the maintained transaction never invokes push, pull, fetch, merge, clone, or a network transport', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-no-remote-git',
    })
    const gitVerbs = []
    const commandRunner = (executable, args, options) => {
      if (executable === '/usr/bin/git') {
        const repositoryIndex = args.indexOf('-C')
        gitVerbs.push(args[repositoryIndex + 2])
        assert.equal(args.some((argument) => /^(?:https?|ssh|git):/u.test(argument)), false)
      }
      return runCommand(executable, args, options)
    }

    await runGitTransaction({
      repositoryRoot,
      paths: state.paths,
      run,
      workItem: claim.content,
      config,
      makerExecutor: repairMaker,
      commandRunner,
    })

    for (const forbidden of ['push', 'pull', 'fetch', 'merge', 'clone']) {
      assert.equal(gitVerbs.includes(forbidden), false)
    }
  })
})

test('cleans an owned branch when maker-worktree creation fails after branch creation', async () => {
  await withTemporaryDirectory(async (directory) => {
    const { repositoryRoot, state, claim, run, config } = fixture(directory, {
      runId: 'run-partial-worktree-create',
    })
    const branch = `agent-loop/${run.runId}-maker`
    const commandRunner = (executable, args, options) => {
      const verbIndex = args.indexOf('-C') + 2
      if (
        executable === '/usr/bin/git'
        && args[verbIndex] === 'worktree'
        && args[verbIndex + 1] === 'add'
        && !args.includes('--detach')
      ) {
        return Object.freeze({
          status: 1,
          signal: null,
          errorCode: null,
          stdout: '',
          stderr: 'Authorization: Bearer secret-value',
        })
      }
      return runCommand(executable, args, options)
    }

    await assert.rejects(
      () => runGitTransaction({
        repositoryRoot,
        paths: state.paths,
        run,
        workItem: claim.content,
        config,
        makerExecutor: repairMaker,
        commandRunner,
      }),
      (error) => {
        assert.equal(error.code, 'MAKER_WORKTREE_CREATE_FAILED')
        assert.doesNotMatch(error.message, /Authorization|Bearer|secret-value/)
        return true
      },
    )

    assert.equal(git(repositoryRoot, 'branch', '--list', branch), '')
  })
})

test('raw Git command failures are replaced by a fixed code and digest', async () => {
  await withTemporaryDirectory(async (directory) => {
    const repositoryRoot = join(directory, 'repository')
    createBrokenRepository(repositoryRoot)
    const rawFailure = 'Authorization: Bearer secret-value\nforged -> pass'

    assert.throws(
      () => assertMakerBranchAvailable({
        repositoryRoot,
        runId: 'run-command-failure',
        commandRunner: () => Object.freeze({
          status: null,
          signal: null,
          errorCode: 'EACCES',
          stdout: '',
          stderr: rawFailure,
        }),
      }),
      (error) => {
        assert.equal(error.code, 'MAKER_BRANCH_OWNERSHIP_UNKNOWN')
        assert.match(error.detailDigest, /^[a-f0-9]{64}$/)
        assert.doesNotMatch(error.message, /Authorization|Bearer|secret-value|forged/)
        return true
      },
    )
  })
})
