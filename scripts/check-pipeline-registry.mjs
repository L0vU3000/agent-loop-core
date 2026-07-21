#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_AGENT_LOOP_ROOT = resolve(SCRIPT_DIRECTORY, '..')

function readRequiredFile(path) {
  if (!existsSync(path)) {
    throw new Error(`missing required registry source: ${path}`)
  }

  return readFileSync(path, 'utf8')
}

function cleanCell(cell) {
  return cell
    .replaceAll('`', '')
    .replaceAll('**', '')
    .trim()
}

function linkLabel(cell) {
  const match = cell.match(/\[([^\]]+)\]\(([^)]+)\)/)
  const label = match ? cleanCell(match[1]) : ''
  return label.split('/').at(-1) || ''
}

function tableRows(markdown, heading) {
  const headingIndex = markdown.indexOf(heading)

  if (headingIndex === -1) {
    throw new Error(`missing registry heading: ${heading}`)
  }

  const lines = markdown.slice(headingIndex + heading.length).split('\n')
  const rows = []
  let tableStarted = false

  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      if (tableStarted) {
        break
      }

      continue
    }

    tableStarted = true
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())

    const isSeparator = cells.every((cell) => /^:?-{3,}:?$/.test(cell))
    if (!isSeparator) {
      rows.push(cells)
    }
  }

  return rows.slice(1)
}

function parseFrontmatter(markdown, path) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/)

  if (!match) {
    throw new Error(`${path}: missing YAML frontmatter`)
  }

  const metadata = {}

  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) {
      continue
    }

    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    metadata[key] = value
  }

  for (const key of ['name', 'category', 'type']) {
    if (!metadata[key]) {
      throw new Error(`${path}: frontmatter is missing ${key}`)
    }
  }

  return {
    name: metadata.name,
    category: metadata.category,
    type: metadata.type,
  }
}

function pipelineDefinitions(agentLoopRoot) {
  const pipelinesDirectory = join(agentLoopRoot, 'pipelines')
  const definitions = []

  for (const entry of readdirSync(pipelinesDirectory).sort()) {
    const pipelineDirectory = join(pipelinesDirectory, entry)
    const definitionPath = join(pipelineDirectory, 'pipeline.md')

    if (!statSync(pipelineDirectory).isDirectory() || !existsSync(definitionPath)) {
      continue
    }

    const metadata = parseFrontmatter(readRequiredFile(definitionPath), definitionPath)
    definitions.push({ ...metadata, directoryName: entry })
  }

  return definitions
}

function categoriesRegistry(agentLoopRoot) {
  const markdown = readRequiredFile(join(agentLoopRoot, 'categories.md'))

  return tableRows(markdown, '## Current pipelines').map((cells) => ({
    category: cleanCell(cells[0] || ''),
    type: cleanCell(cells[1] || ''),
    name: cleanCell(cells[2] || ''),
  }))
}

function pipelinesReadmeRegistry(agentLoopRoot) {
  const markdown = readRequiredFile(join(agentLoopRoot, 'pipelines', 'README.md'))

  return tableRows(markdown, '## Pipelines').map((cells) => ({
    category: cleanCell(cells[0] || ''),
    name: linkLabel(cells[1] || ''),
    type: cleanCell(cells[2] || ''),
  }))
}

function orchestratorRegistry(agentLoopRoot) {
  const markdown = readRequiredFile(join(agentLoopRoot, 'orchestrator', 'orchestrator.md'))

  return tableRows(markdown, '## Routing table (pipeline registry)')
    .filter((cells) => (cells[2] || '').includes('pipeline.md)'))
    .map((cells) => ({
      category: cleanCell(cells[0] || ''),
      type: cleanCell(cells[1] || ''),
      name: linkLabel(cells[2] || ''),
    }))
}

function metadataSignature(metadata) {
  return `${metadata.category}/${metadata.type}/${metadata.name}`
}

function compareRegistry(sourceName, definitions, registryRows, errors) {
  const expectedByName = new Map(definitions.map((definition) => [definition.name, definition]))
  const actualByName = new Map()

  for (const row of registryRows) {
    if (!row.name || !row.category || !row.type) {
      errors.push(`${sourceName}: incomplete registry row ${JSON.stringify(row)}`)
      continue
    }

    if (actualByName.has(row.name)) {
      errors.push(`${sourceName}: duplicate pipeline row for ${row.name}`)
      continue
    }

    actualByName.set(row.name, row)
  }

  for (const definition of definitions) {
    const row = actualByName.get(definition.name)

    if (!row) {
      errors.push(`${sourceName}: missing ${metadataSignature(definition)}`)
      continue
    }

    if (row.category !== definition.category || row.type !== definition.type) {
      errors.push(
        `${sourceName}: ${definition.name} metadata drift; expected `
        + `${definition.category}/${definition.type}, found ${row.category}/${row.type}`,
      )
    }
  }

  for (const row of registryRows) {
    if (!expectedByName.has(row.name)) {
      errors.push(`${sourceName}: ${metadataSignature(row)} has no pipeline frontmatter`)
    }
  }
}

export function validatePipelineRegistry(agentLoopRoot = DEFAULT_AGENT_LOOP_ROOT) {
  const errors = []
  let definitions = []

  try {
    definitions = pipelineDefinitions(agentLoopRoot)

    const names = new Set()
    const routingKeys = new Set()

    for (const definition of definitions) {
      if (definition.name !== definition.directoryName) {
        errors.push(
          `${definition.directoryName}/pipeline.md: name ${definition.name} must match its directory`,
        )
      }

      if (names.has(definition.name)) {
        errors.push(`pipeline frontmatter: duplicate name ${definition.name}`)
      }
      names.add(definition.name)

      const routingKey = `${definition.category}/${definition.type}`
      if (routingKeys.has(routingKey)) {
        errors.push(`pipeline frontmatter: duplicate routing key ${routingKey}`)
      }
      routingKeys.add(routingKey)
    }

    compareRegistry('categories.md', definitions, categoriesRegistry(agentLoopRoot), errors)
    compareRegistry(
      'pipelines/README.md',
      definitions,
      pipelinesReadmeRegistry(agentLoopRoot),
      errors,
    )
    compareRegistry(
      'orchestrator/orchestrator.md',
      definitions,
      orchestratorRegistry(agentLoopRoot),
      errors,
    )
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  return {
    definitions,
    errors,
    ok: errors.length === 0,
  }
}

function cliRoot() {
  const rootOption = process.argv.find((argument) => argument.startsWith('--root='))
  return rootOption ? resolve(rootOption.slice('--root='.length)) : DEFAULT_AGENT_LOOP_ROOT
}

function runCli() {
  const verdict = validatePipelineRegistry(cliRoot())

  if (!verdict.ok) {
    for (const error of verdict.errors) {
      process.stderr.write(`FAIL  ${error}\n`)
    }
    process.stderr.write('check-pipeline-registry: FAILED\n')
    process.exitCode = 1
    return
  }

  process.stdout.write(
    `check-pipeline-registry: ${verdict.definitions.length} pipelines agree across 4 sources\n`,
  )
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  runCli()
}
