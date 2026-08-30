import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'

import { runCommand } from './command.mjs'

const DEFAULT_TIMEOUT_MS = 5 * 60_000
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_USAGE_BYTES = 64 * 1024
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export class HermesMakerError extends Error {
  constructor(code, detail = '') {
    const detailDigest = createHash('sha256').update(String(detail)).digest('hex')
    super(`${code}: ${detailDigest}`)
    this.name = 'HermesMakerError'
    this.code = code
    this.detailDigest = detailDigest
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function readUsageEvidence(path) {
  let descriptor
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    throw new HermesMakerError('HERMES_USAGE_MISSING')
  }

  let text
  try {
    const stats = fstatSync(descriptor)
    if (!stats.isFile()) throw new HermesMakerError('HERMES_USAGE_MISSING')
    if (stats.size > MAX_USAGE_BYTES) {
      throw new HermesMakerError('HERMES_USAGE_OVERSIZED', String(stats.size))
    }

    const bytes = Buffer.alloc(MAX_USAGE_BYTES + 1)
    let bytesRead = 0
    while (bytesRead < bytes.length) {
      const count = readSync(descriptor, bytes, bytesRead, bytes.length - bytesRead, bytesRead)
      if (count === 0) break
      bytesRead += count
    }
    if (bytesRead > MAX_USAGE_BYTES) {
      throw new HermesMakerError('HERMES_USAGE_OVERSIZED', String(bytesRead))
    }
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))
    } catch (error) {
      throw new HermesMakerError('HERMES_USAGE_MALFORMED', String(error?.message ?? error))
    }
  } finally {
    closeSync(descriptor)
  }

  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new HermesMakerError('HERMES_USAGE_MALFORMED', String(error?.message ?? error))
  }
  if (
    !raw || typeof raw !== 'object' || Array.isArray(raw)
    || typeof raw.model !== 'string' || raw.model.length === 0
    || typeof raw.provider !== 'string' || raw.provider.length === 0
    || !Number.isSafeInteger(raw.api_calls) || raw.api_calls < 1
    || !Number.isSafeInteger(raw.total_tokens) || raw.total_tokens < 0
    || typeof raw.estimated_cost_usd !== 'number' || raw.estimated_cost_usd < 0
    || raw.completed !== true || raw.failed !== false
  ) {
    throw new HermesMakerError('HERMES_USAGE_MALFORMED')
  }
  if (!Number.isFinite(raw.estimated_cost_usd)) {
    throw new HermesMakerError('HERMES_USAGE_NON_FINITE')
  }

  return Object.freeze({
    model: raw.model,
    provider: raw.provider,
    apiCalls: raw.api_calls,
    totalTokens: raw.total_tokens,
    estimatedCostUsd: raw.estimated_cost_usd,
    completed: true,
    failed: false,
  })
}

function buildPrompt({ run, workItem, config }) {
  const testCommand = [config.test.executable, ...config.test.args].join(' ')
  return [
    'You are the maker for one bounded agent-loop bug-fix transaction.',
    'This runtime is not an OS sandbox: it only allowlists a narrow process environment and',
    'bounds command output; it does not isolate the filesystem or network.',
    '',
    `Run ID: ${run.runId}`,
    `Base commit: ${run.baseCommit}`,
    '',
    'Work item:',
    workItem.trim(),
    '',
    `Allowed paths (repository-relative, edit only these): ${config.allowedPaths.join(', ')}`,
    `Required test command: ${testCommand}`,
    '',
    'Requirements:',
    '- Work only inside the current Git worktree.',
    '- Edit only the allowed paths listed above.',
    '- Run the required test command and require it to pass before committing.',
    '- Create exactly one Git commit whose parent is the current HEAD; do not create a merge commit.',
    '- Commit with Git hooks and signing disabled (git -c core.hooksPath=/dev/null -c commit.gpgSign=false commit).',
    '- Do not push, merge, fetch, install dependencies, use network tools, or access credentials.',
    '- Leave the worktree clean after the commit.',
    '- Stop after the commit and report what changed and which tests passed.',
  ].join('\n')
}

export function createHermesMaker({
  executable = 'hermes',
  model,
  provider,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  acknowledgeUnsandboxedCredentialAccess = false,
  commandRunner = runCommand,
} = {}) {
  if (acknowledgeUnsandboxedCredentialAccess !== true) {
    throw new HermesMakerError('HERMES_ACKNOWLEDGMENT_REQUIRED')
  }

  return async function executeHermesMaker({ workspace, run, workItem, config }) {
    if (!RUN_ID.test(run?.runId ?? '')) throw new HermesMakerError('RUN_ID_INVALID')
    const runtimeRoot = mkdtempSync(join(tmpdir(), `agent-loop-${run.runId}-hermes-`))
    const usagePath = join(runtimeRoot, 'usage.json')
    try {
      const args = [
        '-z', buildPrompt({ run, workItem, config }),
        '--toolsets', 'terminal,file',
        '--ignore-rules',
        '--usage-file', usagePath,
      ]
      if (model) args.push('--model', model)
      if (provider) args.push('--provider', provider)

      const result = commandRunner(executable, args, {
        cwd: workspace,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        killSignal: 'SIGKILL',
      })

      if (result.errorCode === 'ETIMEDOUT') {
        throw new HermesMakerError('HERMES_TIMEOUT', `${result.status}\0${result.signal}`)
      }
      if (result.errorCode !== null) {
        throw new HermesMakerError('HERMES_SPAWN_FAILED', result.errorCode)
      }
      if (result.status !== 0) {
        throw new HermesMakerError('HERMES_NONZERO_EXIT', String(result.status))
      }

      const usage = readUsageEvidence(usagePath)
      const output = result.stdout ?? ''

      return Object.freeze({
        schemaVersion: 1,
        runtime: 'hermes',
        exitCode: result.status,
        outputSha256: sha256(output),
        outputBytes: Buffer.byteLength(output),
        usage,
      })
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true })
    }
  }
}
