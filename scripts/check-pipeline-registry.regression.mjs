import assert from 'node:assert/strict'
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir as operatingSystemTemporaryDirectory } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { validatePipelineRegistry } from './check-pipeline-registry.mjs'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const SOURCE_ROOT = resolve(SCRIPT_DIRECTORY, '..')

function copyRegistryFixture(destinationRoot) {
  mkdirSync(join(destinationRoot, 'pipelines'), { recursive: true })
  mkdirSync(join(destinationRoot, 'orchestrator'), { recursive: true })

  cpSync(join(SOURCE_ROOT, 'categories.md'), join(destinationRoot, 'categories.md'))
  cpSync(
    join(SOURCE_ROOT, 'pipelines', 'README.md'),
    join(destinationRoot, 'pipelines', 'README.md'),
  )
  cpSync(
    join(SOURCE_ROOT, 'orchestrator', 'orchestrator.md'),
    join(destinationRoot, 'orchestrator', 'orchestrator.md'),
  )

  for (const entry of readdirSync(join(SOURCE_ROOT, 'pipelines'))) {
    const sourceDirectory = join(SOURCE_ROOT, 'pipelines', entry)
    if (!statSync(sourceDirectory).isDirectory()) {
      continue
    }

    const sourceDefinition = join(sourceDirectory, 'pipeline.md')
    const destinationDirectory = join(destinationRoot, 'pipelines', entry)
    mkdirSync(destinationDirectory, { recursive: true })
    cpSync(sourceDefinition, join(destinationDirectory, 'pipeline.md'))
  }
}

test('registry metadata turns red on drift and green when restored', () => {
  const fixtureRoot = mkdtempSync(
    join(operatingSystemTemporaryDirectory(), 'pipeline-registry-check-'),
  )

  try {
    copyRegistryFixture(fixtureRoot)

    const startingVerdict = validatePipelineRegistry(fixtureRoot)
    assert.equal(startingVerdict.ok, true, startingVerdict.errors.join('\n'))

    const target = startingVerdict.definitions[0]
    assert.ok(target, 'fixture must contain at least one pipeline')

    const categoriesPath = join(fixtureRoot, 'categories.md')
    const originalCategories = readFileSync(categoriesPath, 'utf8')
    const originalRow = `| \`${target.category}\` | \`${target.type}\` | \`${target.name}\` |`
    const driftedRow = `| \`${target.category}\` | \`${target.type}-drift\` | \`${target.name}\` |`

    assert.ok(originalCategories.includes(originalRow), `missing fixture row: ${originalRow}`)
    writeFileSync(categoriesPath, originalCategories.replace(originalRow, driftedRow))

    const redVerdict = validatePipelineRegistry(fixtureRoot)
    assert.equal(redVerdict.ok, false, 'drifted registry must fail')
    assert.ok(
      redVerdict.errors.some((error) => error.includes(`${target.name} metadata drift`)),
      redVerdict.errors.join('\n'),
    )

    writeFileSync(categoriesPath, originalCategories)

    const greenVerdict = validatePipelineRegistry(fixtureRoot)
    assert.equal(greenVerdict.ok, true, greenVerdict.errors.join('\n'))
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true })
  }
})
