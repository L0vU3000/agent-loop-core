#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..')

const VALID_TYPES = new Set([
  'architecture',
  'concept',
  'decision',
  'operation',
  'research',
  'recommendation',
  'incident',
  'question',
])

const VALID_STATUSES = new Set([
  'draft',
  'active',
  'accepted',
  'superseded',
  'resolved',
  'archived',
])

const REQUIRED_OPERATIONAL_PATHS = [
  '.gitignore',
  'README.md',
  'STACK.md',
  'agent-loop.md',
  'categories.md',
  'orchestrator/orchestrator.md',
  'orchestrator/dispatch-log.md',
  'pipelines/README.md',
  'pipelines/EVAL.md',
  'memory/README.md',
  'memory/errors.md',
  'memory/decisions.md',
  'memory/changelog.md',
  'resources/README.md',
  'skills-library.md',
]

const REQUIRED_VAULT_PATHS = [
  '.obsidian/app.json',
  '.obsidian/core-plugins.json',
  '.obsidian/appearance.json',
  '.obsidian/templates.json',
  'vault/obsidian.md',
  'vault/log.md',
  'vault/maps/architecture.md',
  'vault/maps/pipelines.md',
  'vault/maps/operations.md',
  'vault/maps/research.md',
  'vault/maps/improvements.md',
  'vault/architecture/system-overview.md',
  'vault/architecture/orchestrator.md',
  'vault/architecture/pipeline-lifecycle.md',
  'vault/architecture/knowledge-layers.md',
  'vault/architecture/distribution-model.md',
  'vault/concepts/maker-verifier-separation.md',
  'vault/concepts/self-improvement.md',
  'vault/concepts/work-items-and-routing.md',
  'vault/concepts/evaluation-and-exit-conditions.md',
  'vault/concepts/memory-and-evidence.md',
  'vault/operations/installing-in-a-project.md',
  'vault/operations/running-the-orchestrator.md',
  'vault/operations/creating-work-items.md',
  'vault/operations/reviewing-and-recording-runs.md',
  'vault/operations/promoting-core-improvements.md',
  'vault/operations/syncing-core-updates.md',
  'vault/decisions/README.md',
  'vault/research/README.md',
  'vault/recommendations/README.md',
  'vault/recommendations/cross-project-sync.md',
  'vault/project/README.md',
  'vault/project/decisions/README.md',
  'vault/project/research/README.md',
  'vault/project/recommendations/README.md',
  'vault/project/incidents/README.md',
  'vault/project/open-questions.md',
  'vault/project/tasks.md',
  'vault/project/changelog.md',
  'vault/project/inbox/.gitkeep',
  'vault/project/attachments/.gitkeep',
  'vault/templates/decision.md',
  'vault/templates/research-note.md',
  'vault/templates/recommendation.md',
  'vault/templates/incident.md',
  'vault/templates/open-question.md',
]

const REQUIRED_HOME_LINKS = [
  'README',
  'agent-loop',
  'categories',
  'orchestrator/orchestrator',
  'pipelines/README',
  'pipelines/EVAL',
  'memory/README',
  'resources/README',
  'skills-library',
  'STACK',
  'vault/maps/architecture',
  'vault/maps/pipelines',
  'vault/maps/operations',
  'vault/maps/research',
  'vault/maps/improvements',
]

const PERSONAL_OBSIDIAN_PATH = /^\.obsidian\/(?:workspace(?:-[^/]*)?\.json|cache(?:\/.*)?|plugins(?:\/.*)?|themes(?:\/.*)?|snippets(?:\/.*)?|graph\.json|hotkeys\.json|community-plugins\.json)$/

const GENERATED_STATE_PATHS = [
  /^pipelines\/[^/]+\/runs\/(?!\.gitkeep$)/,
  /^orchestrator\/inbox\/(?:.*\.md$)/,
  /^orchestrator\/done\/(?:.*\.md$)/,
  /^orchestrator\/\.heartbeat$/,
  /^memory\/run-metrics\.jsonl$/,
  /^vault\/project\/attachments\/(?!\.gitkeep$)/,
]

const REQUIRED_IGNORE_RULES = [
  '.obsidian/workspace*.json',
  '.obsidian/cache/',
  '.obsidian/plugins/',
  '.obsidian/community-plugins.json',
  '.obsidian/themes/',
  '.obsidian/snippets/',
  '.obsidian/graph.json',
  '.obsidian/hotkeys.json',
  'vault/project/attachments/*',
  '!vault/project/attachments/.gitkeep',
]

const EMPTY_DISPATCH_LOG = '<!-- Dispatch ledger — one line per dispatched item: `- <item-slug> -> pass|fail (<summary>)`. Newest at the bottom. Machinery appends here. -->\n'

function toPosix(path) {
  return path.split(sep).join('/')
}

export function listFiles(root) {
  const files = []

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.context') continue
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(toPosix(relative(root, absolute)))
    }
  }

  visit(root)
  return files.sort()
}

function trackedFiles(root) {
  try {
    const output = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' })
    return output.split('\n').filter(Boolean)
  } catch {
    return listFiles(root)
  }
}

function readJson(root, path, errors) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'))
  } catch (error) {
    errors.push(`${path}: invalid JSON (${error.message})`)
    return null
  }
}

function parseFrontmatter(source) {
  const lines = source.split(/\r?\n/)
  if (lines[0] !== '---') return null
  const end = lines.indexOf('---', 1)
  if (end === -1) return null

  const fields = new Map()
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([a-z][a-z0-9-]*):\s*(.*)$/)
    if (match) fields.set(match[1], match[2].replace(/^['"]|['"]$/g, ''))
  }
  return fields
}

function validateFrontmatter(path, source, errors) {
  const fields = parseFrontmatter(source)
  if (!fields) {
    errors.push(`${path}: missing or malformed frontmatter`)
    return
  }

  const type = fields.get('type')
  const status = fields.get('status')
  if (!VALID_TYPES.has(type)) errors.push(`${path}: unsupported type '${type ?? ''}'`)
  if (!VALID_STATUSES.has(status)) errors.push(`${path}: unsupported status '${status ?? ''}'`)

  for (const field of ['created', 'updated']) {
    const value = fields.get(field) ?? ''
    const isTemplateDate = path.startsWith('vault/templates/') && value === '{{date:YYYY-MM-DD}}'
    if (!isTemplateDate && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errors.push(`${path}: ${field} must be YYYY-MM-DD`)
    }
  }

  if (!fields.has('tags')) errors.push(`${path}: missing tags field`)
  if (!/^\s+- agent-loop\s*$/m.test(source)) errors.push(`${path}: tags must include agent-loop`)
}

export function wikilinkTargets(source) {
  const targets = []
  const pattern = /\[\[([^\]]+)\]\]/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    const withoutAlias = match[1].split('|', 1)[0]
    const withoutHeading = withoutAlias.split('#', 1)[0].trim()
    if (withoutHeading) targets.push(withoutHeading)
  }
  return targets
}

function internalMarkdownLinks(source) {
  const targets = []
  const pattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    const target = match[1].trim()
    if (target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    targets.push(target)
  }
  return targets
}

function resolveWikilink(root, sourcePath, target) {
  const candidates = []
  const cleanTarget = target.endsWith('.md') ? target : `${target}.md`
  candidates.push(join(root, cleanTarget))
  candidates.push(join(root, dirname(sourcePath), cleanTarget))

  if (!target.includes('/')) {
    const matches = listFiles(root).filter((path) => path.endsWith(`/${cleanTarget}`) || path === cleanTarget)
    if (matches.length === 1) candidates.push(join(root, matches[0]))
  }

  return candidates.some((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

function validateSettings(root, errors) {
  const app = readJson(root, '.obsidian/app.json', errors)
  const corePlugins = readJson(root, '.obsidian/core-plugins.json', errors)
  readJson(root, '.obsidian/appearance.json', errors)
  const templates = readJson(root, '.obsidian/templates.json', errors)

  if (app) {
    if (app.alwaysUpdateLinks !== true) errors.push('.obsidian/app.json: alwaysUpdateLinks must be true')
    if (app.newFileLocation !== 'folder' || app.newFileFolderPath !== 'vault/project/inbox') {
      errors.push('.obsidian/app.json: new notes must default to vault/project/inbox')
    }
    if (app.attachmentFolderPath !== 'vault/project/attachments') {
      errors.push('.obsidian/app.json: attachments must use vault/project/attachments')
    }
  }

  if (!corePlugins || Array.isArray(corePlugins) || typeof corePlugins !== 'object') {
    errors.push('.obsidian/core-plugins.json: expected a core-plugin settings object')
  } else if (corePlugins.templates !== true) {
    errors.push('.obsidian/core-plugins.json: the Templates core plugin must be enabled')
  }

  if (!templates || templates.folder !== 'vault/templates') {
    errors.push('.obsidian/templates.json: template folder must be vault/templates')
  }
}

export function validateVault(root = DEFAULT_ROOT, options = {}) {
  const absoluteRoot = resolve(root)
  const errors = []

  for (const path of [...REQUIRED_OPERATIONAL_PATHS, ...REQUIRED_VAULT_PATHS]) {
    if (!existsSync(join(absoluteRoot, path))) errors.push(`${path}: required path is missing`)
  }

  validateSettings(absoluteRoot, errors)

  const ignorePath = join(absoluteRoot, '.gitignore')
  if (existsSync(ignorePath)) {
    const ignoreRules = new Set(
      readFileSync(ignorePath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    )
    for (const rule of REQUIRED_IGNORE_RULES) {
      if (!ignoreRules.has(rule)) errors.push(`.gitignore: missing Obsidian safety rule '${rule}'`)
    }
  }

  const dispatchLogPath = join(absoluteRoot, 'orchestrator/dispatch-log.md')
  if (existsSync(dispatchLogPath) && readFileSync(dispatchLogPath, 'utf8') !== EMPTY_DISPATCH_LOG) {
    errors.push('orchestrator/dispatch-log.md: template must not contain dispatch history')
  }

  const vaultFiles = existsSync(join(absoluteRoot, 'vault'))
    ? listFiles(join(absoluteRoot, 'vault')).map((path) => `vault/${path}`)
    : []

  for (const path of vaultFiles.filter((path) => path.endsWith('.md'))) {
    const basename = path.split('/').at(-1)
    if (basename !== 'README.md' && !/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(basename)) {
      errors.push(`${path}: filename must use lowercase kebab-case`)
    }

    const source = readFileSync(join(absoluteRoot, path), 'utf8')
    validateFrontmatter(path, source, errors)

    for (const target of internalMarkdownLinks(source)) {
      errors.push(`${path}: internal Markdown link '${target}' must use an Obsidian wikilink`)
    }

    for (const target of wikilinkTargets(source)) {
      if (!resolveWikilink(absoluteRoot, path, target)) {
        errors.push(`${path}: unresolved wikilink [[${target}]]`)
      }
    }
  }

  const homePath = join(absoluteRoot, 'vault/obsidian.md')
  if (existsSync(homePath)) {
    const homeLinks = new Set(wikilinkTargets(readFileSync(homePath, 'utf8')))
    for (const target of REQUIRED_HOME_LINKS) {
      if (!homeLinks.has(target)) errors.push(`vault/obsidian.md: missing Map of Content link [[${target}]]`)
    }
  }

  const tracked = options.trackedFiles ?? trackedFiles(absoluteRoot)
  for (const path of tracked) {
    if (PERSONAL_OBSIDIAN_PATH.test(path)) {
      errors.push(`${path}: personal Obsidian state must not be tracked`)
    }
    if (GENERATED_STATE_PATHS.some((pattern) => pattern.test(path))) {
      errors.push(`${path}: generated or project-private state must not be tracked`)
    }
  }

  return errors
}

function runCli() {
  const errors = validateVault(DEFAULT_ROOT)
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`FAIL  ${error}\n`)
    process.stderr.write(`check-vault: FAILED (${errors.length} issue(s))\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write('check-vault: all good\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli()
