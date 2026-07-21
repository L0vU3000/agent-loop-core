#!/usr/bin/env node

// Work-item checker — the gate between "AI drafted an inbox file from what you said" and "the
// router dispatches it". It answers one question: does this file have everything the
// orchestration needs? It reuses the router's own frontmatter parser and pipeline registry, so a
// PASS here means the file WILL route — no second source of truth to drift.
//
// Two layers of check:
//   - routing (hard): frontmatter present, type is registered, category matches that type.
//   - completeness (hard + soft): a testable "Done" line the eval can score against; boundaries
//     are recommended. The semantic quality of the Done line (can a fresh verifier check it?) is
//     an AI judgment the /intake command makes on top of this deterministic floor.
//
// Usage:
//   node agent-loop/orchestrator/check-work-item.mjs <path-to-item.md>
//   node agent-loop/orchestrator/check-work-item.mjs <path> --json

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { parseItemFrontmatter } from './dispatch.mjs'
import { validatePipelineRegistry } from '../scripts/check-pipeline-registry.mjs'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_AGENT_LOOP_ROOT = resolve(SCRIPT_DIRECTORY, '..')

const VALID_PRIORITIES = ['low', 'normal', 'high']

// Pure: check one item's markdown against a type->definition map. Returns problems (block the
// item) and warnings (let it through but flag). This is what the regression test drives.
export function checkWorkItem(markdown, byType) {
  const problems = []
  const warnings = []

  const frontmatter = parseItemFrontmatter(markdown)
  if (!frontmatter || !frontmatter.category || !frontmatter.type) {
    problems.push('missing frontmatter — needs both `category:` and `type:` in a `---` block')
    return { ok: false, problems, warnings, routing: null }
  }

  const { category, type } = frontmatter
  const priority = frontmatter.priority || 'normal'
  const pipeline = byType.get(type)

  if (!pipeline) {
    const known = [...byType.keys()].sort().join(', ')
    problems.push(`unknown type "${type}" — valid types are: ${known}`)
  } else if (pipeline.category !== category) {
    problems.push(`category "${category}" does not match type "${type}" — that type routes to ${pipeline.name} (category "${pipeline.category}")`)
  }

  if (!VALID_PRIORITIES.includes(priority)) {
    problems.push(`priority "${priority}" must be one of: ${VALID_PRIORITIES.join(', ')}`)
  }
  if (!frontmatter.created || !/^\d{4}-\d{2}-\d{2}$/.test(frontmatter.created)) {
    warnings.push('missing or non-ISO `created:` date (use YYYY-MM-DD)')
  }

  const body = markdown.replace(/^---\n[\s\S]*?\n---/, '').trim()
  if (body.length < 40) {
    problems.push('body is empty or too thin — state the objective and what "done" looks like')
  }
  // The load-bearing line: the eval scores the result against the stated exit condition. The
  // house convention is a quoted `"Done" = ...` that can sit mid-sentence; also accept a
  // line-start `Done:` / `Done =` / `done means`.
  const hasDoneLine = /"done"\s*[=:]/i.test(body) || /(^|\n)\s*done\s*(=|:|means)/i.test(body)
  if (!hasDoneLine) {
    problems.push('no testable "Done =" line — add one exit condition a fresh verifier could check without you')
  }
  // Boundaries stop a worker gaming the exit condition; recommended, not required.
  const hasBoundaries = /do\s*not|don'?t|avoid|must not|no\s+force/i.test(body)
  if (!hasBoundaries) {
    warnings.push('no boundaries ("Do NOT" section) — recommended so a worker cannot game the exit condition')
  }

  const ok = problems.length === 0
  return {
    ok,
    problems,
    warnings,
    routing: pipeline ? { category, type, priority, pipeline: pipeline.name } : null,
  }
}

function runCli(agentLoopRoot = DEFAULT_AGENT_LOOP_ROOT) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--json')
  const asJson = process.argv.includes('--json')
  const file = args[0]

  if (!file) {
    process.stderr.write('usage: check-work-item.mjs <path-to-item.md> [--json]\n')
    process.exitCode = 2
    return
  }
  if (!existsSync(file)) {
    process.stderr.write(`check-work-item: file not found: ${file}\n`)
    process.exitCode = 2
    return
  }

  const registry = validatePipelineRegistry(agentLoopRoot)
  const byType = new Map(registry.definitions.map((definition) => [definition.type, definition]))
  const result = checkWorkItem(readFileSync(file, 'utf8'), byType)

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (result.ok) {
    const route = result.routing
    process.stdout.write(`PASS  routes to ${route.pipeline}  [${route.category}/${route.type}, ${route.priority}]\n`)
    for (const warning of result.warnings) {
      process.stdout.write(`  warn  ${warning}\n`)
    }
  } else {
    process.stdout.write('FAIL  not ready for the inbox:\n')
    for (const problem of result.problems) {
      process.stdout.write(`  - ${problem}\n`)
    }
    for (const warning of result.warnings) {
      process.stdout.write(`  warn  ${warning}\n`)
    }
  }

  process.exitCode = result.ok ? 0 : 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  runCli()
}
