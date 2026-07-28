import { readFileSync } from 'node:fs'
import { posix } from 'node:path'

const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'pipeline', 'test', 'allowedPaths'])
const TEST_KEYS = new Set(['executable', 'args'])

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

export function loadConfig(configPath) {
  const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
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
  return deepFreeze(parsed)
}
