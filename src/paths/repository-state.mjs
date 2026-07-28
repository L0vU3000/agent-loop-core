import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'

const GIT = '/usr/bin/git'

function gitOutput(repositoryPath, args, env) {
  const result = spawnSync(GIT, ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
    env: {
      HOME: env.HOME ?? homedir(),
      PATH: '/usr/bin:/bin',
      LANG: env.LANG ?? 'C.UTF-8',
    },
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  })
  if (result.status !== 0) throw new Error('repositoryPath must be a Git repository')
  return result.stdout.trim()
}

function defaultStateHome(env) {
  if (env.XDG_STATE_HOME !== undefined) {
    if (!isAbsolute(env.XDG_STATE_HOME)) throw new Error('XDG_STATE_HOME must be absolute')
    return resolve(env.XDG_STATE_HOME)
  }
  const home = env.HOME ?? homedir()
  if (!isAbsolute(home)) throw new Error('HOME must be absolute')
  return join(resolve(home), '.local', 'state')
}

function canonicalizeProspectivePath(inputPath) {
  let cursor = resolve(inputPath)
  const missingSegments = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error('path has no existing ancestor')
    missingSegments.unshift(basename(cursor))
    cursor = parent
  }
  return resolve(realpathSync(cursor), ...missingSegments)
}

function containsPath(parent, candidate) {
  const relation = relative(parent, candidate)
  return relation === '' || (
    relation !== '..'
    && !relation.startsWith(`..${sep}`)
    && !isAbsolute(relation)
  )
}

export function assertRootsDisjoint(repositoryRoot, stateRoot, protectedLabel = 'the target repository') {
  const canonicalRepositoryRoot = canonicalizeProspectivePath(repositoryRoot)
  const canonicalStateRoot = canonicalizeProspectivePath(stateRoot)
  if (
    containsPath(canonicalRepositoryRoot, canonicalStateRoot)
    || containsPath(canonicalStateRoot, canonicalRepositoryRoot)
  ) {
    throw new Error(`state root must not overlap ${protectedLabel}`)
  }
  return Object.freeze({
    repositoryRoot: canonicalRepositoryRoot,
    stateRoot: canonicalStateRoot,
  })
}

export function deriveRepositoryState({ repositoryPath, stateRoot, env = process.env }) {
  const reportedRoot = gitOutput(repositoryPath, ['rev-parse', '--show-toplevel'], env)
  const repositoryRoot = realpathSync(reportedRoot)
  const reportedCommonDirectory = gitOutput(
    repositoryRoot,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    env,
  )
  const gitCommonDirectory = realpathSync(reportedCommonDirectory)
  const repositoryKey = createHash('sha256')
    .update(repositoryRoot)
    .update('\0')
    .update(gitCommonDirectory)
    .digest('hex')
    .slice(0, 24)
  if (stateRoot !== undefined && !isAbsolute(stateRoot)) {
    throw new Error('stateRoot must be absolute')
  }
  const requestedStateRoot = stateRoot === undefined
    ? join(defaultStateHome(env), 'agent-loop', 'repositories', repositoryKey)
    : resolve(stateRoot)
  const { stateRoot: resolvedStateRoot } = assertRootsDisjoint(repositoryRoot, requestedStateRoot)
  assertRootsDisjoint(gitCommonDirectory, resolvedStateRoot, 'Git metadata')
  const paths = Object.freeze({
    pending: join(resolvedStateRoot, 'inbox', 'pending'),
    inProgress: join(resolvedStateRoot, 'inbox', 'in-progress'),
    done: join(resolvedStateRoot, 'inbox', 'done'),
    failed: join(resolvedStateRoot, 'inbox', 'failed'),
    runs: join(resolvedStateRoot, 'runs'),
    evidence: join(resolvedStateRoot, 'evidence'),
    dispatchLog: join(resolvedStateRoot, 'logs', 'dispatch.jsonl'),
    worktrees: join(resolvedStateRoot, 'worktrees'),
  })

  return Object.freeze({
    repositoryRoot,
    gitCommonDirectory,
    repositoryKey,
    stateRoot: resolvedStateRoot,
    paths,
  })
}
