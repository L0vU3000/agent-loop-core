import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadConfig } from '../src/config/load-config.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-config-test-'))
  try {
    return run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function validConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    pipeline: 'bug-fix',
    test: {
      executable: 'node',
      args: ['--test'],
    },
    allowedPaths: ['src/add.mjs'],
    maker: {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      timeoutMs: 300000,
    },
    ...overrides,
  }
}

test('loads, normalizes, and deeply freezes a valid target configuration', () => {
  withTemporaryDirectory((directory) => {
    const configPath = join(directory, 'config.json')
    writeFileSync(configPath, JSON.stringify(validConfig()))

    const config = loadConfig(configPath)

    assert.deepEqual(config, validConfig())
    assert.equal(Object.isFrozen(config), true)
    assert.equal(Object.isFrozen(config.test), true)
    assert.equal(Object.isFrozen(config.test.args), true)
    assert.equal(Object.isFrozen(config.allowedPaths), true)
    assert.equal(Object.isFrozen(config.maker), true)
  })
})

test('rejects symbolic-link configuration files before reading them', () => {
  withTemporaryDirectory((directory) => {
    const targetPath = join(directory, 'target.json')
    const configPath = join(directory, 'config.json')
    writeFileSync(targetPath, JSON.stringify(validConfig()))
    symlinkSync(targetPath, configPath)

    assert.throws(() => loadConfig(configPath), /regular file/)
  })
})

test('rejects oversized configuration files before parsing them', () => {
  withTemporaryDirectory((directory) => {
    const configPath = join(directory, 'config.json')
    writeFileSync(configPath, ' '.repeat((64 * 1024) + 1))

    assert.throws(() => loadConfig(configPath), /size limit/)
  })
})

test('rejects unsupported configuration schema versions', () => {
  withTemporaryDirectory((directory) => {
    const configPath = join(directory, 'config.json')
    writeFileSync(configPath, JSON.stringify(validConfig({ schemaVersion: 2 })))

    assert.throws(() => loadConfig(configPath), /unsupported schemaVersion: 2/)
  })
})

test('rejects unknown top-level configuration keys', () => {
  withTemporaryDirectory((directory) => {
    const configPath = join(directory, 'config.json')
    writeFileSync(configPath, JSON.stringify(validConfig({ apiKey: 'must-not-be-accepted' })))

    assert.throws(() => loadConfig(configPath), /unknown configuration key: apiKey/)
  })
})

test('supports only the bug-fix pipeline in the first productized slice', () => {
  withTemporaryDirectory((directory) => {
    const configPath = join(directory, 'config.json')
    writeFileSync(configPath, JSON.stringify(validConfig({ pipeline: 'feature' })))

    assert.throws(() => loadConfig(configPath), /pipeline must be bug-fix/)
  })
})

test('rejects malformed or shell-like objective test commands', () => {
  const invalidTests = [
    null,
    { executable: '', args: [] },
    { executable: 'node --test', args: [] },
    { executable: 'node;rm', args: [] },
    { executable: 'node\0bad', args: [] },
    { executable: 'node', args: '--test' },
    { executable: 'node', args: [1] },
    { executable: 'node', args: ['bad\0arg'] },
    { executable: 'node', args: [], shell: true },
  ]

  withTemporaryDirectory((directory) => {
    for (const [index, testCommand] of invalidTests.entries()) {
      const configPath = join(directory, `config-${index}.json`)
      writeFileSync(configPath, JSON.stringify(validConfig({ test: testCommand })))
      assert.throws(() => loadConfig(configPath), Error, `case ${index} should fail`)
    }
  })
})

test('rejects unsafe, ambiguous, empty, and duplicate allowed paths', () => {
  const invalidAllowedPaths = [
    [],
    'src/add.mjs',
    ['/absolute/path'],
    ['../outside.mjs'],
    ['src/../outside.mjs'],
    ['./src/add.mjs'],
    ['src\\add.mjs'],
    ['src/bad\0name.mjs'],
    [''],
    ['.'],
    ['src/'],
    ['src/add.mjs', 'src/add.mjs'],
    ['.agent-loop/config.json'],
  ]

  withTemporaryDirectory((directory) => {
    for (const [index, allowedPaths] of invalidAllowedPaths.entries()) {
      const configPath = join(directory, `config-${index}.json`)
      writeFileSync(configPath, JSON.stringify(validConfig({ allowedPaths })))
      assert.throws(() => loadConfig(configPath), Error, `case ${index} should fail`)
    }
  })
})

test('rejects a missing maker route/timeout configuration', () => {
  withTemporaryDirectory((directory) => {
    const configPath = join(directory, 'config.json')
    writeFileSync(configPath, JSON.stringify(validConfig({ maker: undefined })))

    assert.throws(() => loadConfig(configPath), /maker must be a JSON object/)
  })
})

test('rejects unknown maker keys', () => {
  withTemporaryDirectory((directory) => {
    const configPath = join(directory, 'config.json')
    writeFileSync(configPath, JSON.stringify(validConfig({
      maker: {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        timeoutMs: 300000,
        apiKey: 'must-not-be-accepted',
      },
    })))

    assert.throws(() => loadConfig(configPath), /unknown maker key: apiKey/)
  })
})

test('rejects legacy maxTurns as an unknown maker key', () => {
  withTemporaryDirectory((directory) => {
    const configPath = join(directory, 'config.json')
    writeFileSync(configPath, JSON.stringify(validConfig({
      maker: {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        timeoutMs: 300000,
        maxTurns: 40,
      },
    })))

    assert.throws(() => loadConfig(configPath), /unknown maker key: maxTurns/)
  })
})

test('rejects unsafe, empty, or non-identifier maker provider and model values', () => {
  const invalidRoutes = [
    { provider: '', model: 'claude-sonnet-5' },
    { provider: 'anthropic', model: '' },
    { provider: 'anthropic;rm', model: 'claude-sonnet-5' },
    { provider: 'anthropic', model: 'claude sonnet 5' },
    { provider: '-anthropic', model: 'claude-sonnet-5' },
    { provider: 'anthropic', model: '--model-injection' },
    { provider: 'anthropic\0', model: 'claude-sonnet-5' },
    { provider: 1, model: 'claude-sonnet-5' },
    { provider: 'anthropic', model: null },
  ]

  withTemporaryDirectory((directory) => {
    for (const [index, route] of invalidRoutes.entries()) {
      const configPath = join(directory, `config-${index}.json`)
      writeFileSync(configPath, JSON.stringify(validConfig({
        maker: { provider: 'anthropic', model: 'claude-sonnet-5', timeoutMs: 300000, ...route },
      })))
      assert.throws(() => loadConfig(configPath), Error, `case ${index} should fail`)
    }
  })
})

test('rejects maker timeoutMs outside sensible finite integer bounds', () => {
  const invalidBounds = [
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 1.5 },
    { timeoutMs: 999 },
    { timeoutMs: 3_600_001 },
    { timeoutMs: Infinity },
    { timeoutMs: '300000' },
  ]

  withTemporaryDirectory((directory) => {
    for (const [index, override] of invalidBounds.entries()) {
      const configPath = join(directory, `config-${index}.json`)
      writeFileSync(configPath, JSON.stringify(validConfig({
        maker: { provider: 'anthropic', model: 'claude-sonnet-5', timeoutMs: 300000, ...override },
      })))
      assert.throws(() => loadConfig(configPath), Error, `case ${index} should fail`)
    }
  })
})

test('ships an example accepted by the executable schema', () => {
  assert.deepEqual(loadConfig(join(ROOT, 'examples', 'config.json')), validConfig())
})
