import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_TIMEOUT_MS = 5 * 60_000
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_USAGE_BYTES = 64 * 1024

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function readUsageEvidence(path) {
  const size = statSync(path).size
  if (size === 0 || size > MAX_USAGE_BYTES) throw new Error('Hermes maker wrote invalid usage evidence')
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('Hermes maker wrote invalid usage evidence')
  }
  if (
    !raw || typeof raw !== 'object'
    || typeof raw.model !== 'string' || raw.model.length === 0
    || typeof raw.provider !== 'string' || raw.provider.length === 0
    || !Number.isSafeInteger(raw.api_calls) || raw.api_calls < 1
    || !Number.isSafeInteger(raw.total_tokens) || raw.total_tokens < 0
    || !Number.isFinite(raw.estimated_cost_usd) || raw.estimated_cost_usd < 0
    || raw.completed !== true || raw.failed !== false
  ) {
    throw new Error('Hermes maker wrote invalid usage evidence')
  }
  return {
    model: raw.model,
    provider: raw.provider,
    apiCalls: raw.api_calls,
    totalTokens: raw.total_tokens,
    estimatedCostUsd: raw.estimated_cost_usd,
    completed: true,
    failed: false,
  }
}

function buildPrompt({ run, workItem }) {
  return [
    'You are the maker for one bounded agent-loop bug-fix transaction.',
    `Run ID: ${run.runId}`,
    '',
    'Work item:',
    workItem.trim(),
    '',
    'Requirements:',
    '- Work only inside the current Git worktree.',
    '- Inspect the existing code and tests before editing.',
    '- Make the smallest correct repair for this work item.',
    '- Run the existing test suite and require it to pass.',
    '- Stage only the intended repair.',
    '- Create exactly one Git commit whose parent is the current HEAD.',
    '- Do not push, merge, fetch, install dependencies, use network tools, or access credentials.',
    '- Commit with Git hooks and signing disabled for this disposable transaction.',
    '- Leave the worktree clean.',
    '- Stop after the commit and report what changed and which tests passed.',
  ].join('\n')
}

function runtimeEnvironment(workspace) {
  const environment = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? workspace,
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    LANG: process.env.LANG ?? 'C.UTF-8',
    NO_COLOR: '1',
    GIT_TERMINAL_PROMPT: '0',
  }
  if (process.env.HERMES_HOME) environment.HERMES_HOME = process.env.HERMES_HOME
  return environment
}

export function createHermesMakerRuntime({
  executable = 'hermes',
  model,
  provider,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  acknowledgeUnsandboxedCredentialAccess = false,
} = {}) {
  if (!acknowledgeUnsandboxedCredentialAccess) {
    throw new Error('unsandboxed credential access must be explicitly acknowledged')
  }
  return async function executeHermesMaker({ workspace, run, workItem }) {
    const runtimeRoot = mkdtempSync(join(tmpdir(), `agent-loop-${run.runId}-hermes-`))
    const usagePath = join(runtimeRoot, 'usage.json')
    try {
      const args = [
        '-z', buildPrompt({ run, workItem }),
        '--toolsets', 'terminal,file',
        '--ignore-rules',
        '--usage-file', usagePath,
      ]
      if (model) args.push('--model', model)
      if (provider) args.push('--provider', provider)

      const result = spawnSync(executable, args, {
        cwd: workspace,
        encoding: 'utf8',
        env: runtimeEnvironment(workspace),
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_OUTPUT_BYTES,
      })
      if (result.error || result.status !== 0) {
        const reason = result.error?.code === 'ETIMEDOUT'
          ? 'timeout'
          : result.error
            ? 'spawn-error'
            : 'nonzero-exit'
        throw new Error(`Hermes maker failed (${reason}, exitCode=${result.status ?? 'none'})`)
      }
      if (!existsSync(usagePath)) throw new Error('Hermes maker did not write usage evidence')

      const output = result.stdout ?? ''

      return {
        schemaVersion: 1,
        runtime: 'hermes',
        exitCode: result.status,
        outputSha256: sha256(output),
        outputBytes: Buffer.byteLength(output),
        usage: readUsageEvidence(usagePath),
      }
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true })
    }
  }
}
