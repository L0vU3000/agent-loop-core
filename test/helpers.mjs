import { createHash } from 'node:crypto'

const SHA256 = /^[a-f0-9]{64}$/

export function canonicalMakerRuntime(overrides = {}) {
  const usage = {
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    apiCalls: 1,
    totalTokens: 42,
    estimatedCostUsd: 0.01,
    completed: true,
    failed: false,
    ...(overrides.usage ?? {}),
  }
  const runtime = {
    runtime: 'hermes',
    exitCode: 0,
    outputSha256: createHash('sha256').update('normalized output\n').digest('hex'),
    outputBytes: 17,
    usage: Object.freeze(usage),
    ...overrides,
  }
  if (overrides.usage) {
    runtime.usage = Object.freeze(usage)
  }
  return Object.freeze(runtime)
}

export function canonicalUsage(overrides = {}) {
  return Object.freeze({
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    apiCalls: 1,
    totalTokens: 42,
    estimatedCostUsd: 0.01,
    completed: true,
    failed: false,
    ...overrides,
  })
}

export function assertIsSha256(value) {
  if (!SHA256.test(value)) throw new Error(`expected sha256 hex, got ${String(value)}`)
}
