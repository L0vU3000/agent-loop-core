import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
} from 'node:fs'
import { posix } from 'node:path'

const MAX_CONFIG_BYTES = 64 * 1024

const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'pipeline', 'test', 'allowedPaths', 'maker'])
const TEST_KEYS = new Set(['executable', 'args'])
const MAKER_KEYS = new Set(['provider', 'model', 'timeoutMs', 'maxTurns'])
const SAFE_MAKER_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const MIN_MAKER_TIMEOUT_MS = 1_000
const MAX_MAKER_TIMEOUT_MS = 3_600_000
const MIN_MAKER_MAX_TURNS = 1
const MAX_MAKER_MAX_TURNS = 200

function validateTestCommand(testCommand) {
  if (!testCommand || typeof testCommand !== 'object' || Array.isArray(testCommand)) {
    throw new Error('test must be a JSON object')
  }
  for (const key of Object.keys(testCommand)) {
    if (!TEST_KEYS.has(key)) throw new Error(`unknown test key: ${key}`)
  }
  if (
    typeof testCommand.executable !== 'string'
    || testCommand.executable.length === 0
    || /[\s;&|<>`$(){}[\]*?!~\0]/u.test(testCommand.executable)
  ) {
    throw new Error('test.executable must be one safe executable token')
  }
  if (!Array.isArray(testCommand.args)) throw new Error('test.args must be an array')
  for (const argument of testCommand.args) {
    if (typeof argument !== 'string' || argument.includes('\0')) {
      throw new Error('test.args entries must be strings without NUL')
    }
  }
}

export function assertMakerRoute(maker) {
  if (!maker || typeof maker !== 'object' || Array.isArray(maker)) {
    throw new Error('maker must be a JSON object')
  }
  for (const key of Object.keys(maker)) {
    if (!MAKER_KEYS.has(key)) throw new Error(`unknown maker key: ${key}`)
  }
  if (typeof maker.provider !== 'string' || !SAFE_MAKER_IDENTIFIER.test(maker.provider)) {
    throw new Error('maker.provider must be a safe non-empty identifier')
  }
  if (typeof maker.model !== 'string' || !SAFE_MAKER_IDENTIFIER.test(maker.model)) {
    throw new Error('maker.model must be a safe non-empty identifier')
  }
  if (
    !Number.isInteger(maker.timeoutMs)
    || maker.timeoutMs < MIN_MAKER_TIMEOUT_MS
    || maker.timeoutMs > MAX_MAKER_TIMEOUT_MS
  ) {
    throw new Error(`maker.timeoutMs must be an integer between ${MIN_MAKER_TIMEOUT_MS} and ${MAX_MAKER_TIMEOUT_MS}`)
  }
  if (
    !Number.isInteger(maker.maxTurns)
    || maker.maxTurns < MIN_MAKER_MAX_TURNS
    || maker.maxTurns > MAX_MAKER_MAX_TURNS
  ) {
    throw new Error(`maker.maxTurns must be an integer between ${MIN_MAKER_MAX_TURNS} and ${MAX_MAKER_MAX_TURNS}`)
  }
}

function validateAllowedPaths(allowedPaths) {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    throw new Error('allowedPaths must be a non-empty array')
  }
  const seen = new Set()
  for (const allowedPath of allowedPaths) {
    if (
      typeof allowedPath !== 'string'
      || allowedPath.length === 0
      || allowedPath.includes('\0')
      || allowedPath.includes('\\')
      || posix.isAbsolute(allowedPath)
      || allowedPath.endsWith('/')
      || posix.normalize(allowedPath) !== allowedPath
      || allowedPath === '.'
      || allowedPath === '.agent-loop'
      || allowedPath.startsWith('.agent-loop/')
      || allowedPath.split('/').includes('..')
    ) {
      throw new Error(`invalid allowed path: ${String(allowedPath)}`)
    }
    if (seen.has(allowedPath)) throw new Error(`duplicate allowed path: ${allowedPath}`)
    seen.add(allowedPath)
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function readConfigFile(configPath) {
  let descriptor
  try {
    descriptor = openSync(
      configPath,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    )
  } catch {
    throw new Error('configuration must be a readable regular file')
  }

  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile()) throw new Error('configuration must be a regular file')
    if (metadata.size > MAX_CONFIG_BYTES) throw new Error('configuration exceeds size limit')

    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const count = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, bytesRead)
      if (count === 0) break
      bytesRead += count
    }
    if (bytesRead > MAX_CONFIG_BYTES) throw new Error('configuration exceeds size limit')
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    closeSync(descriptor)
  }
}

export function loadConfig(configPath) {
  const parsed = JSON.parse(readConfigFile(configPath))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('configuration must be a JSON object')
  }
  if (parsed?.schemaVersion !== 1) {
    throw new Error(`unsupported schemaVersion: ${String(parsed?.schemaVersion)}`)
  }
  for (const key of Object.keys(parsed)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new Error(`unknown configuration key: ${key}`)
  }
  if (parsed.pipeline !== 'bug-fix') throw new Error('pipeline must be bug-fix')
  validateTestCommand(parsed.test)
  validateAllowedPaths(parsed.allowedPaths)
  assertMakerRoute(parsed.maker)
  return deepFreeze(parsed)
}
