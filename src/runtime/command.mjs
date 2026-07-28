import { spawnSync } from 'node:child_process'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, relative, sep } from 'node:path'

const ALLOWED_ENVIRONMENT_KEYS = [
  'HERMES_HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
]

function containsPath(parent, candidate) {
  const relation = relative(parent, candidate)
  return relation === '' || (
    relation !== '..'
    && !relation.startsWith(`..${sep}`)
    && !isAbsolute(relation)
  )
}

function pathsOverlap(left, right) {
  return containsPath(left, right) || containsPath(right, left)
}

export function sanitizePath(env = process.env, excludedRoots = []) {
  const canonicalExcludedRoots = excludedRoots.map((root) => realpathSync(root))
  const entries = []
  for (const directory of (env.PATH ?? '/usr/bin:/bin').split(delimiter)) {
    if (!isAbsolute(directory)) continue
    try {
      const canonicalDirectory = realpathSync(directory)
      if (!statSync(canonicalDirectory).isDirectory()) continue
      if (canonicalExcludedRoots.some((root) => pathsOverlap(root, canonicalDirectory))) continue
      if (!entries.includes(canonicalDirectory)) entries.push(canonicalDirectory)
    } catch {
      // Ignore missing, inaccessible, or non-directory PATH entries.
    }
  }
  return entries.join(delimiter)
}

export function findExecutable(name, env = process.env, excludedRoots = []) {
  if (name.length === 0 || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('executable name must be one basename')
  }
  const canonicalExcludedRoots = excludedRoots.map((root) => realpathSync(root))
  for (const directory of sanitizePath(env, excludedRoots).split(delimiter)) {
    if (!isAbsolute(directory)) continue
    const candidate = join(directory, name)
    try {
      const canonicalCandidate = realpathSync(candidate)
      accessSync(canonicalCandidate, constants.X_OK)
      if (!statSync(canonicalCandidate).isFile()) continue
      if (canonicalExcludedRoots.some((root) => pathsOverlap(root, canonicalCandidate))) continue
      return canonicalCandidate
    } catch {
      // Continue searching without exposing filesystem details.
    }
  }
  return null
}

export function commandEnvironment(env = process.env) {
  const allowed = {
    HOME: env.HOME ?? homedir(),
    PATH: sanitizePath(env),
    LANG: env.LANG ?? 'C.UTF-8',
  }
  for (const key of ALLOWED_ENVIRONMENT_KEYS) {
    if (env[key] !== undefined) allowed[key] = env[key]
  }
  return allowed
}

export function runCommand(executable, args, {
  cwd,
  env = process.env,
  timeout = 10_000,
  maxBuffer = 1024 * 1024,
} = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: commandEnvironment(env),
    timeout,
    maxBuffer,
    shell: false,
  })
  return Object.freeze({
    status: result.status,
    signal: result.signal,
    errorCode: result.error?.code ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  })
}
