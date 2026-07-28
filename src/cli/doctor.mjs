import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmdirSync,
  statSync,
} from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'

import { loadConfig } from '../config/load-config.mjs'
import { deriveRepositoryState } from '../paths/repository-state.mjs'
import { findExecutable, runCommand, sanitizePath } from '../runtime/command.mjs'

const GIT = '/usr/bin/git'
const HARDENED_GIT_OPTIONS = [
  '--no-optional-locks',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null',
]
const CHECK_IDS = [
  'node.version',
  'git.executable',
  'git.repository',
  'git.head',
  'git.clean',
  'config.valid',
  'state.disjoint',
  'state.writable',
  'hermes.executable',
  'sandbox.deferred',
]

function check(id, status, message) {
  return Object.freeze({ id, status, message })
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function commandPassed(result) {
  return result.status === 0 && result.signal === null && result.errorCode === null
}

function descriptorRoot() {
  if (existsSync('/proc/self/fd')) return '/proc/self/fd'
  if (existsSync('/dev/fd')) return '/dev/fd'
  throw new Error('descriptor-relative filesystem access is unavailable')
}

function descriptorChild(root, descriptor, name) {
  return join(root, String(descriptor), name)
}

function probeWritableDirectory(stateRoot) {
  const fdRoot = descriptorRoot()
  const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  const segments = resolve(stateRoot).split(sep).filter(Boolean)
  const descriptors = []
  const createdDirectories = []
  let probeName
  let cleanupError

  try {
    descriptors.push(openSync(sep, directoryFlags))
    for (const segment of segments) {
      const parentDescriptor = descriptors.at(-1)
      const childPath = descriptorChild(fdRoot, parentDescriptor, segment)
      let childDescriptor
      try {
        childDescriptor = openSync(childPath, directoryFlags)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        mkdirSync(childPath)
        createdDirectories.push({ parentDescriptor, segment })
        childDescriptor = openSync(childPath, directoryFlags)
      }
      descriptors.push(childDescriptor)
    }

    const stateDescriptor = descriptors.at(-1)
    const probe = mkdtempSync(descriptorChild(fdRoot, stateDescriptor, '.agent-loop-doctor-'))
    probeName = basename(probe)
  } finally {
    if (probeName !== undefined && descriptors.length > 0) {
      try {
        rmdirSync(descriptorChild(fdRoot, descriptors.at(-1), probeName))
      } catch (error) {
        cleanupError ??= error
      }
    }
    for (const { parentDescriptor, segment } of createdDirectories.reverse()) {
      try {
        rmdirSync(descriptorChild(fdRoot, parentDescriptor, segment))
      } catch (error) {
        cleanupError ??= error
      }
    }
    for (const descriptor of descriptors.reverse()) {
      try {
        closeSync(descriptor)
      } catch (error) {
        cleanupError ??= error
      }
    }
    if (cleanupError !== undefined) throw cleanupError
  }
}

export function runDoctor(options, {
  env = process.env,
  execute = runCommand,
  locateExecutable = findExecutable,
  nodeVersion = process.versions.node,
} = {}) {
  const checks = []
  const majorVersion = Number.parseInt(nodeVersion.split('.')[0], 10)
  checks.push(check(
    'node.version',
    Number.isInteger(majorVersion) && majorVersion >= 18 ? 'pass' : 'fail',
    Number.isInteger(majorVersion) && majorVersion >= 18
      ? 'Node.js 18 or newer is available.'
      : 'Node.js 18 or newer is required.',
  ))

  const gitVersion = execute(GIT, [...HARDENED_GIT_OPTIONS, '--version'], { env })
  checks.push(check(
    'git.executable',
    commandPassed(gitVersion) ? 'pass' : 'fail',
    commandPassed(gitVersion) ? 'Git is available.' : 'Git is unavailable.',
  ))

  const repositoryPath = resolve(options.repo)
  const repositoryExists = existsSync(repositoryPath) && isDirectory(repositoryPath)
  const repositoryResult = repositoryExists
    ? execute(GIT, [
      ...HARDENED_GIT_OPTIONS,
      '-C', repositoryPath,
      'rev-parse', '--show-toplevel',
    ], { env })
    : null
  let repositoryRoot = null
  if (repositoryResult !== null && commandPassed(repositoryResult)) {
    try {
      const reportedRoot = repositoryResult.stdout.trim()
      repositoryRoot = reportedRoot.length > 0 ? realpathSync(reportedRoot) : null
      if (repositoryRoot !== null && !isDirectory(repositoryRoot)) repositoryRoot = null
    } catch {
      repositoryRoot = null
    }
  }
  const repositoryReady = repositoryRoot !== null
  checks.push(check(
    'git.repository',
    repositoryReady ? 'pass' : 'fail',
    repositoryReady ? 'Target is a Git repository.' : 'Target must exist and be a Git repository.',
  ))

  const headResult = repositoryReady
    ? execute(GIT, [
      ...HARDENED_GIT_OPTIONS,
      '-C', repositoryRoot,
      'rev-parse', '--verify', 'HEAD^{commit}',
    ], { env })
    : null
  const headReady = headResult !== null
    && commandPassed(headResult)
    && /^(?:[a-f0-9]{40}|[a-f0-9]{64})\n?$/u.test(headResult.stdout)
  checks.push(check(
    'git.head',
    headReady ? 'pass' : 'fail',
    headReady ? 'HEAD resolves to one commit.' : 'Target HEAD must resolve to one commit.',
  ))

  const cleanResult = repositoryReady
    ? execute(GIT, [
      ...HARDENED_GIT_OPTIONS,
      '-C', repositoryRoot,
      'status', '--porcelain=v1', '--untracked-files=normal',
    ], { env })
    : null
  const clean = cleanResult !== null && commandPassed(cleanResult) && cleanResult.stdout === ''
  checks.push(check(
    'git.clean',
    clean ? 'pass' : 'fail',
    clean ? 'Target checkout is clean.' : 'Target checkout must be clean.',
  ))

  const targetRoot = repositoryRoot ?? repositoryPath
  const configPath = options.config === undefined
    ? join(targetRoot, '.agent-loop', 'config.json')
    : resolve(options.config)
  let configValid = false
  try {
    loadConfig(configPath)
    configValid = true
  } catch {
    // Report only a stable diagnostic; configuration contents may contain secrets.
  }
  checks.push(check(
    'config.valid',
    configValid ? 'pass' : 'fail',
    configValid ? 'Configuration is valid.' : 'Configuration is invalid.',
  ))

  let state
  try {
    state = deriveRepositoryState({
      repositoryPath: targetRoot,
      stateRoot: options.stateRoot,
      env,
    })
  } catch {
    state = null
  }
  checks.push(check(
    'state.disjoint',
    state === null ? 'fail' : 'pass',
    state === null
      ? 'External state root is unsafe or cannot be resolved.'
      : 'External state root is disjoint from the target and Git metadata.',
  ))

  let stateWritable = false
  if (state !== null) {
    try {
      probeWritableDirectory(state.stateRoot)
      stateWritable = true
    } catch {
      stateWritable = false
    }
  }
  checks.push(check(
    'state.writable',
    stateWritable ? 'pass' : 'fail',
    stateWritable ? 'External state root is writable.' : 'External state root must be writable.',
  ))

  let hermesVersion = null
  if (state !== null) {
    const excludedExecutableRoots = [state.repositoryRoot, state.gitCommonDirectory]
    const hermesEnv = {
      ...env,
      PATH: sanitizePath(env, excludedExecutableRoots),
    }
    const hermesPath = locateExecutable('hermes', hermesEnv, excludedExecutableRoots)
    if (hermesPath !== null) {
      hermesVersion = execute(hermesPath, ['--version'], { env: hermesEnv })
    }
  }
  const hermesReady = hermesVersion !== null && commandPassed(hermesVersion)
  checks.push(check(
    'hermes.executable',
    hermesReady ? 'pass' : 'fail',
    hermesReady
      ? 'Hermes is installed and responds without a provider call.'
      : 'Hermes must be installed and available on PATH.',
  ))

  checks.push(check(
    'sandbox.deferred',
    'warning',
    'This runtime is not an OS sandbox; use only disposable repositories and non-production credentials.',
  ))

  if (checks.map(({ id }) => id).join('\0') !== CHECK_IDS.join('\0')) {
    throw new Error('internal doctor check ordering failure')
  }
  const healthy = checks.every(({ status }) => status !== 'fail')
  return Object.freeze({
    schemaVersion: 1,
    healthy,
    checks: Object.freeze(checks),
  })
}

export function doctorExitCode(report) {
  const repositoryCheck = report.checks.find(({ id }) => id === 'git.repository')
  const configCheck = report.checks.find(({ id }) => id === 'config.valid')
  if (repositoryCheck?.status === 'pass' && configCheck?.status === 'fail') return 2
  return report.healthy ? 0 : 1
}

export function formatDoctorReport(report) {
  const lines = report.checks.map(({ id, status, message }) => {
    const marker = status === 'pass' ? 'PASS' : status === 'warning' ? 'WARN' : 'FAIL'
    return `[${marker}] ${id}: ${message}`
  })
  lines.push(report.healthy ? 'Doctor result: healthy.' : 'Doctor result: unhealthy.')
  return `${lines.join('\n')}\n`
}
