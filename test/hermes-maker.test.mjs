import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createHermesMaker } from '../src/runtime/hermes-maker.mjs'
import { canonicalMakerRuntime } from './helpers.mjs'

const RUN = Object.freeze({ runId: 'run-hermes-maker', baseCommit: '1'.repeat(40) })
const WORK_ITEM = 'Fix src/add.mjs so the existing test passes.'
const CONFIG = Object.freeze({
  allowedPaths: Object.freeze(['src/add.mjs']),
  test: Object.freeze({ executable: 'node', args: Object.freeze(['--test']) }),
})

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-hermes-maker-test-'))
  return Promise.resolve()
    .then(() => run(directory))
    .finally(() => rmSync(directory, { recursive: true, force: true }))
}

function writeFakeHermes(executable, { rejectSecret = true } = {}) {
  writeFileSync(executable, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (${rejectSecret} && process.env.SPIKE_SECRET_SENTINEL !== undefined) process.exit(91)
if (!args.includes('--ignore-rules')) process.exit(92)
if (!args.includes('--toolsets') || !args.includes('terminal,file')) process.exit(93)
const usageIndex = args.indexOf('--usage-file')
if (usageIndex === -1) process.exit(94)
writeFileSync('marker.txt', 'maker ran here\\n')
writeFileSync(args[usageIndex + 1], JSON.stringify({ model: 'fake-model', provider: 'fake-provider', api_calls: 1, total_tokens: 42, estimated_cost_usd: 0.01, completed: true, failed: false }))
process.stdout.write('Maker completed and committed the repair.\\n')
`)
  chmodSync(executable, 0o755)
}

function leftoverHermesTempDirectories(runId) {
  return readdirSync(tmpdir()).filter((name) => name.startsWith(`agent-loop-${runId}-hermes-`))
}

function validUsagePayload() {
  return JSON.stringify({
    model: 'fake-model',
    provider: 'fake-provider',
    api_calls: 1,
    total_tokens: 42,
    estimated_cost_usd: 0.01,
    completed: true,
    failed: false,
  })
}

function succeedingCommandRunner({ capture } = {}) {
  return (executable, args, options) => {
    if (capture) capture({ executable, args, options })
    const usageIndex = args.indexOf('--usage-file')
    writeFileSync(args[usageIndex + 1], validUsagePayload())
    return Object.freeze({
      status: 0,
      signal: null,
      errorCode: null,
      stdout: 'Maker completed and committed the repair.\n',
      stderr: '',
    })
  }
}

test('refuses to build a maker unless unsandboxed credential access is explicitly acknowledged', () => {
  assert.throws(
    () => createHermesMaker(),
    (error) => {
      assert.equal(error.code, 'HERMES_ACKNOWLEDGMENT_REQUIRED')
      return true
    },
  )
  assert.throws(
    () => createHermesMaker({ acknowledgeUnsandboxedCredentialAccess: false }),
    (error) => error.code === 'HERMES_ACKNOWLEDGMENT_REQUIRED',
  )
})

test('rejects an invalid, missing, or unsafe maker route before returning a callable maker', () => {
  const invalidRoutes = [
    { label: 'missing provider', overrides: { provider: undefined } },
    { label: 'null provider', overrides: { provider: null } },
    { label: 'unsafe provider', overrides: { provider: 'anthropic;rm' } },
    { label: 'missing model', overrides: { model: undefined } },
    { label: 'null model', overrides: { model: null } },
    { label: 'unsafe model', overrides: { model: 'claude sonnet 5' } },
    { label: 'timeoutMs below minimum', overrides: { timeoutMs: 999 } },
    { label: 'timeoutMs above maximum', overrides: { timeoutMs: 3_600_001 } },
    { label: 'non-integer timeoutMs', overrides: { timeoutMs: 1.5 } },
    { label: 'maxTurns below minimum', overrides: { maxTurns: 0 } },
    { label: 'maxTurns above maximum', overrides: { maxTurns: 201 } },
    { label: 'non-integer maxTurns', overrides: { maxTurns: 1.5 } },
  ]

  for (const { label, overrides } of invalidRoutes) {
    let invoked = false
    assert.throws(
      () => createHermesMaker({
        model: 'fake-model',
        provider: 'fake-provider',
        maxTurns: 40,
        timeoutMs: 30_000,
        acknowledgeUnsandboxedCredentialAccess: true,
        commandRunner: () => {
          invoked = true
          return Object.freeze({ status: 0, signal: null, errorCode: null, stdout: '', stderr: '' })
        },
        ...overrides,
      }),
      (error) => {
        assert.equal(error.code, 'HERMES_ROUTE_INVALID', label)
        return true
      },
      label,
    )
    assert.equal(invoked, false, label)
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0, label)
  }
})

test('rejects an unsafe run ID before creating temporary state or invoking Hermes', async () => {
  let invoked = false
  const maker = createHermesMaker({
    model: 'fake-model',
    provider: 'fake-provider',
    maxTurns: 40,
    acknowledgeUnsandboxedCredentialAccess: true,
    commandRunner: () => {
      invoked = true
      return Object.freeze({ status: 0, signal: null, errorCode: null, stdout: '', stderr: '' })
    },
  })

  await assert.rejects(
    () => maker({
      workspace: tmpdir(),
      run: { ...RUN, runId: '../../../../escape' },
      workItem: WORK_ITEM,
      config: CONFIG,
    }),
    (error) => error.code === 'RUN_ID_INVALID',
  )
  assert.equal(invoked, false)
})

test('runs in the exact maker workspace, excludes parent secrets, and returns normalized digest-bound evidence', async () => {
  const previousSecret = process.env.SPIKE_SECRET_SENTINEL
  process.env.SPIKE_SECRET_SENTINEL = 'must-not-cross-maker-boundary'
  try {
    await withTemporaryDirectory(async (directory) => {
      const workspace = join(directory, 'workspace')
      mkdirSync(workspace, { recursive: true })
      const fakeHermes = join(directory, 'fake-hermes.mjs')
      writeFakeHermes(fakeHermes)

      const maker = createHermesMaker({
        executable: fakeHermes,
        model: 'fake-model',
        provider: 'fake-provider',
        maxTurns: 40,
        timeoutMs: 30_000,
        acknowledgeUnsandboxedCredentialAccess: true,
      })
      const result = await maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG })

      assert.equal(existsSync(join(workspace, 'marker.txt')), true)
      assert.equal(result.schemaVersion, undefined)
      assert.equal(result.runtime, 'hermes')
      assert.equal(result.exitCode, 0)
      assert.equal(result.stdout, undefined)
      assert.equal(result.stderr, undefined)
      assert.equal(result.output, undefined)
      assert.equal(result.model, undefined)
      assert.equal(result.provider, undefined)
      assert.equal(result.apiCalls, undefined)
      assert.equal(result.totalTokens, undefined)
      assert.equal(result.estimatedCostUsd, undefined)
      assert.equal(result.completed, undefined)
      assert.equal(result.failed, undefined)
      assert.match(result.outputSha256, /^[a-f0-9]{64}$/)
      assert.equal(
        result.outputSha256,
        createHash('sha256').update('Maker completed and committed the repair.\n').digest('hex'),
      )
      assert.equal(result.outputBytes, Buffer.byteLength('Maker completed and committed the repair.\n'))
      assert.deepEqual(result.usage, {
        model: 'fake-model',
        provider: 'fake-provider',
        apiCalls: 1,
        totalTokens: 42,
        estimatedCostUsd: 0.01,
        completed: true,
        failed: false,
      })
      assert.deepEqual(result, {
        runtime: 'hermes',
        exitCode: 0,
        outputSha256: result.outputSha256,
        outputBytes: result.outputBytes,
        usage: {
          model: 'fake-model',
          provider: 'fake-provider',
          apiCalls: 1,
          totalTokens: 42,
          estimatedCostUsd: 0.01,
          completed: true,
          failed: false,
        },
      })
      assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
    })
  } finally {
    if (previousSecret === undefined) delete process.env.SPIKE_SECRET_SENTINEL
    else process.env.SPIKE_SECRET_SENTINEL = previousSecret
  }
})

test('binds the immutable run and work item, allowed paths, test command, and safety rules into the prompt', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    let captured
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 17,
      timeoutMs: 12_345,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: succeedingCommandRunner({ capture: (call) => { captured = call } }),
    })

    await maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG })

    assert.equal(captured.options.cwd, workspace)
    assert.equal(captured.options.timeout, 12_345)
    assert.equal(captured.options.maxBuffer, 1024 * 1024)
    assert.equal(captured.options.killSignal, 'SIGKILL')
    assert.equal(captured.args.includes('--ignore-rules'), true)
    const toolsetsIndex = captured.args.indexOf('--toolsets')
    assert.equal(captured.args[toolsetsIndex + 1], 'terminal,file')
    assert.equal(captured.args[captured.args.indexOf('--model') + 1], 'fake-model')
    assert.equal(captured.args[captured.args.indexOf('--provider') + 1], 'fake-provider')
    assert.equal(captured.args[captured.args.indexOf('--max-turns') + 1], '17')
    const prompt = captured.args[captured.args.indexOf('-z') + 1]
    assert.match(prompt, new RegExp(RUN.runId))
    assert.match(prompt, new RegExp(RUN.baseCommit))
    assert.match(prompt, /Fix src\/add\.mjs so the existing test passes\./)
    assert.match(prompt, /src\/add\.mjs/)
    assert.match(prompt, /node --test/)
    assert.match(prompt, /exactly one Git commit/i)
    assert.match(prompt, /do not create a merge commit/i)
    assert.match(prompt, /do not push, merge/i)
    assert.match(prompt, /core\.hooksPath=\/dev\/null/i)
    assert.match(prompt, /commit\.gpgSign=false/i)
    assert.match(prompt, /not an OS sandbox/i)
  })
})

test('passes only the allowlisted HOME/HERMES_HOME/PATH/locale/temp environment keys to the maker process', async () => {
  const previousHermesHome = process.env.HERMES_HOME
  process.env.HERMES_HOME = '/tmp/does-not-need-to-exist-hermes-home'
  process.env.SPIKE_SECRET_SENTINEL_2 = 'must-not-cross-maker-boundary'
  try {
    await withTemporaryDirectory(async (directory) => {
      const workspace = join(directory, 'workspace')
      mkdirSync(workspace, { recursive: true })
      const envDumpPath = join(directory, 'env.json')
      const fakeHermes = join(directory, 'fake-hermes-env.mjs')
      writeFileSync(fakeHermes, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const usageIndex = args.indexOf('--usage-file')
writeFileSync(${JSON.stringify(envDumpPath)}, JSON.stringify(Object.keys(process.env).sort()))
writeFileSync(args[usageIndex + 1], JSON.stringify({ model: 'fake-model', provider: 'fake-provider', api_calls: 1, total_tokens: 42, estimated_cost_usd: 0.01, completed: true, failed: false }))
process.stdout.write('done\\n')
`)
      chmodSync(fakeHermes, 0o755)

      const maker = createHermesMaker({
        executable: fakeHermes,
        model: 'fake-model',
        provider: 'fake-provider',
        maxTurns: 40,
        timeoutMs: 30_000,
        acknowledgeUnsandboxedCredentialAccess: true,
      })
      await maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG })

      const observedKeys = new Set(JSON.parse(readFileSync(envDumpPath, 'utf8')))
      const allowedKeys = new Set(['HOME', 'HERMES_HOME', 'PATH', 'LANG', 'LC_ALL', 'TMPDIR'])
      for (const key of observedKeys) {
        assert.equal(allowedKeys.has(key), true, `unexpected environment key leaked to maker: ${key}`)
      }
      assert.equal(observedKeys.has('SPIKE_SECRET_SENTINEL_2'), false)
      assert.equal(observedKeys.has('HERMES_HOME'), true)
    })
  } finally {
    if (previousHermesHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = previousHermesHome
    delete process.env.SPIKE_SECRET_SENTINEL_2
  }
})

test('reports a fixed failure message when the maker process times out', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: () => Object.freeze({
        status: null,
        signal: 'SIGTERM',
        errorCode: 'ETIMEDOUT',
        stdout: 'partial untrusted output',
        stderr: 'partial untrusted stderr',
      }),
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => {
        assert.equal(error.code, 'HERMES_TIMEOUT')
        assert.doesNotMatch(error.message, /partial untrusted/)
        assert.match(error.detailDigest, /^[a-f0-9]{64}$/)
        return true
      },
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('reports a fixed failure message when the maker process exits nonzero', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: () => Object.freeze({
        status: 1,
        signal: null,
        errorCode: null,
        stdout: 'untrusted stdout',
        stderr: 'Authorization: Bearer ***',
      }),
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => {
        assert.equal(error.code, 'HERMES_NONZERO_EXIT')
        assert.doesNotMatch(error.message, /Authorization|Bearer|secret-value|untrusted/)
        return true
      },
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('fails closed when producer outputBytes exceeds the canonical 1 MiB ceiling', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const oneMiBPlusOne = 'x'.repeat(1024 * 1024) + 'x'
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: (executable, args) => {
        const usageIndex = args.indexOf('--usage-file')
        writeFileSync(args[usageIndex + 1], validUsagePayload())
        return Object.freeze({
          status: 0,
          signal: null,
          errorCode: null,
          stdout: oneMiBPlusOne,
          stderr: '',
        })
      },
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => error.code === 'HERMES_OUTPUT_OVERSIZED',
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('accepts producer outputBytes just below the canonical 1 MiB ceiling', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const justUnderOneMiB = 'x'.repeat(1024 * 1024 - 1)
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: (executable, args) => {
        const usageIndex = args.indexOf('--usage-file')
        writeFileSync(args[usageIndex + 1], validUsagePayload())
        return Object.freeze({
          status: 0,
          signal: null,
          errorCode: null,
          stdout: justUnderOneMiB,
          stderr: '',
        })
      },
    })

    const result = await maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG })
    assert.equal(result.outputBytes, 1024 * 1024 - 1)
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('fails closed when usage apiCalls, totalTokens, or estimatedCostUsd are above the canonical maxima', async () => {
  const ceilingCases = [
    { field: 'api_calls', value: 1_000_001, code: 'HERMES_USAGE_OVERSIZED' },
    { field: 'total_tokens', value: 1_000_000_001, code: 'HERMES_USAGE_OVERSIZED' },
    { field: 'estimated_cost_usd', value: 1_000_000.01, code: 'HERMES_USAGE_OVERSIZED' },
  ]

  await withTemporaryDirectory(async (directory) => {
    for (const { field, value, code } of ceilingCases) {
      const workspace = join(directory, 'workspace')
      mkdirSync(workspace, { recursive: true })
      const payload = { model: 'fake-model', provider: 'fake-provider', api_calls: 1, total_tokens: 42, estimated_cost_usd: 0.01, completed: true, failed: false }
      payload[field] = value
      const maker = createHermesMaker({
        model: 'fake-model',
        provider: 'fake-provider',
        maxTurns: 40,
        acknowledgeUnsandboxedCredentialAccess: true,
        commandRunner: (executable, args) => {
          const usageIndex = args.indexOf('--usage-file')
          writeFileSync(args[usageIndex + 1], JSON.stringify(payload))
          return Object.freeze({
            status: 0,
            signal: null,
            errorCode: null,
            stdout: 'Maker completed.\\n',
            stderr: '',
          })
        },
      })

      await assert.rejects(
        () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
        (error) => error.code === code,
        `expected ${code} for ${field}=${value}`,
      )
      assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
    }
  })
})

test('accepts usage values at the canonical maxima', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: (executable, args) => {
        const usageIndex = args.indexOf('--usage-file')
        writeFileSync(args[usageIndex + 1], JSON.stringify({
          model: 'fake-model',
          provider: 'fake-provider',
          api_calls: 1_000_000,
          total_tokens: 1_000_000_000,
          estimated_cost_usd: 1_000_000,
          completed: true,
          failed: false,
        }))
        return Object.freeze({
          status: 0,
          signal: null,
          errorCode: null,
          stdout: 'Maker completed.\\n',
          stderr: '',
        })
      },
    })

    const result = await maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG })
    assert.equal(result.usage.apiCalls, 1_000_000)
    assert.equal(result.usage.totalTokens, 1_000_000_000)
    assert.equal(result.usage.estimatedCostUsd, 1_000_000)
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('reports a fixed failure message when Hermes cannot be spawned', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: () => Object.freeze({
        status: null,
        signal: null,
        errorCode: 'ENOENT',
        stdout: 'untrusted stdout',
        stderr: 'untrusted stderr',
      }),
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => {
        assert.equal(error.code, 'HERMES_SPAWN_FAILED')
        assert.doesNotMatch(error.message, /untrusted/)
        return true
      },
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('reports a fixed failure message when the maker never writes usage evidence', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: () => Object.freeze({
        status: 0,
        signal: null,
        errorCode: null,
        stdout: 'Maker completed.\n',
        stderr: '',
      }),
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => error.code === 'HERMES_USAGE_MISSING',
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('rejects usage evidence reached through a symbolic link', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const externalUsage = join(directory, 'external-usage.json')
    writeFileSync(externalUsage, validUsagePayload())
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: (executable, args) => {
        const usageIndex = args.indexOf('--usage-file')
        symlinkSync(externalUsage, args[usageIndex + 1])
        return Object.freeze({
          status: 0,
          signal: null,
          errorCode: null,
          stdout: 'Maker completed.\n',
          stderr: '',
        })
      },
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => error.code === 'HERMES_USAGE_MISSING',
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('reports a fixed failure message when usage evidence exceeds the size limit', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: (executable, args) => {
        const usageIndex = args.indexOf('--usage-file')
        writeFileSync(args[usageIndex + 1], 'x'.repeat(64 * 1024 + 1))
        return Object.freeze({
          status: 0,
          signal: null,
          errorCode: null,
          stdout: 'Maker completed.\n',
          stderr: '',
        })
      },
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => error.code === 'HERMES_USAGE_OVERSIZED',
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('rejects usage evidence reporting zero api calls before maker success', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: (executable, args) => {
        const usageIndex = args.indexOf('--usage-file')
        writeFileSync(args[usageIndex + 1], JSON.stringify({
          model: 'fake-model',
          provider: 'fake-provider',
          api_calls: 0,
          total_tokens: 42,
          estimated_cost_usd: 0.01,
          completed: true,
          failed: false,
        }))
        return Object.freeze({
          status: 0,
          signal: null,
          errorCode: null,
          stdout: 'Maker completed.\n',
          stderr: '',
        })
      },
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => error.code === 'HERMES_USAGE_MALFORMED',
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('reports a fixed failure message when usage evidence is malformed', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: (executable, args) => {
        const usageIndex = args.indexOf('--usage-file')
        writeFileSync(args[usageIndex + 1], '{not valid json')
        return Object.freeze({
          status: 0,
          signal: null,
          errorCode: null,
          stdout: 'Maker completed.\n',
          stderr: '',
        })
      },
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => error.code === 'HERMES_USAGE_MALFORMED',
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('rejects usage evidence containing malformed UTF-8', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: (executable, args) => {
        const usageIndex = args.indexOf('--usage-file')
        const invalidUtf8Usage = Buffer.concat([
          Buffer.from('{"model":"'),
          Buffer.from([0xff]),
          Buffer.from('","provider":"fake","api_calls":1,"total_tokens":42,"estimated_cost_usd":0,"completed":true,"failed":false}'),
        ])
        writeFileSync(args[usageIndex + 1], invalidUtf8Usage)
        return Object.freeze({
          status: 0,
          signal: null,
          errorCode: null,
          stdout: 'Maker completed.\n',
          stderr: '',
        })
      },
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => error.code === 'HERMES_USAGE_MALFORMED',
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('reports a fixed failure message when usage evidence has a non-finite cost', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'fake-model',
      provider: 'fake-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: (executable, args) => {
        const usageIndex = args.indexOf('--usage-file')
        writeFileSync(
          args[usageIndex + 1],
          '{"model":"fake","provider":"fake","api_calls":1,"total_tokens":42,"estimated_cost_usd":1e400,"completed":true,"failed":false}',
        )
        return Object.freeze({
          status: 0,
          signal: null,
          errorCode: null,
          stdout: 'Maker completed.\n',
          stderr: '',
        })
      },
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => error.code === 'HERMES_USAGE_NON_FINITE',
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})

test('fails closed when the maker reports usage for a different provider or model than was configured', async () => {
  await withTemporaryDirectory(async (directory) => {
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const maker = createHermesMaker({
      model: 'configured-model',
      provider: 'configured-provider',
      maxTurns: 40,
      acknowledgeUnsandboxedCredentialAccess: true,
      commandRunner: (executable, args) => {
        const usageIndex = args.indexOf('--usage-file')
        writeFileSync(args[usageIndex + 1], JSON.stringify({
          model: 'other-model',
          provider: 'configured-provider',
          api_calls: 1,
          total_tokens: 42,
          estimated_cost_usd: 0.01,
          completed: true,
          failed: false,
        }))
        return Object.freeze({
          status: 0,
          signal: null,
          errorCode: null,
          stdout: 'Maker completed.\n',
          stderr: '',
        })
      },
    })

    await assert.rejects(
      () => maker({ workspace, run: RUN, workItem: WORK_ITEM, config: CONFIG }),
      (error) => error.code === 'HERMES_ROUTE_MISMATCH',
    )
    assert.equal(leftoverHermesTempDirectories(RUN.runId).length, 0)
  })
})
