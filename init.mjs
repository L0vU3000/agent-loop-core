#!/usr/bin/env node
// init.mjs — adopt the agent-loop into a project.
//
// What it does:
//   1. Confirms this folder sits one level under a repo root (the machinery
//      resolves the repo as its own parent directory).
//   2. Resets all instance data to an empty slate (safe to re-run — idempotent).
//   3. Reports any pipeline prose still carrying the ORIGIN project's vocabulary,
//      so you know exactly which files to adapt to the new project.
//
// Run once, from inside the agent-loop folder, right after you copy it in:
//   node init.mjs
//
// Pure Node built-ins — no npm install.

import { readdirSync, existsSync, rmSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT_LOOP_ROOT = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(AGENT_LOOP_ROOT, '..')

// Terms that mean "this file still describes the project we copied FROM."
// Edit this list to match wherever you extracted the core from.
const ORIGIN_TERMS = ['valgate', 'neon', 'drizzle', 'clerk', 'lib/services', '/pro/']

function log(line) {
  process.stdout.write(line + '\n')
}

// --- 1. sanity: are we placed correctly? ---------------------------------
if (!existsSync(join(REPO_ROOT, '.git'))) {
  log(`⚠  ${REPO_ROOT} is not a git repo root (no .git found).`)
  log('   Place the agent-loop folder ONE level under your project root, e.g. <project>/agent-loop/.')
  log('   Continuing anyway — the machinery only needs the folder layout, not git.\n')
}

// --- 2. reset instance data to empty -------------------------------------
// Remove every generated .md in the queues and run folders, but keep the
// directory skeleton (the .gitkeep files) so the machinery has somewhere to write.
function clearMarkdown(dir) {
  if (!existsSync(dir)) return 0
  let removed = 0
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.md')) {
      rmSync(join(dir, name))
      removed++
    }
  }
  return removed
}

let wiped = 0
wiped += clearMarkdown(join(AGENT_LOOP_ROOT, 'orchestrator', 'inbox'))
wiped += clearMarkdown(join(AGENT_LOOP_ROOT, 'orchestrator', 'inbox', 'done'))
wiped += clearMarkdown(join(AGENT_LOOP_ROOT, 'orchestrator', 'inbox', 'failed'))
wiped += clearMarkdown(join(AGENT_LOOP_ROOT, 'orchestrator', 'done'))

// Empty every pipeline's runs/ folder (keep .gitkeep).
const pipelinesDir = join(AGENT_LOOP_ROOT, 'pipelines')
if (existsSync(pipelinesDir)) {
  for (const pipeline of readdirSync(pipelinesDir)) {
    const runs = join(pipelinesDir, pipeline, 'runs')
    if (existsSync(runs) && statSync(runs).isDirectory()) {
      for (const name of readdirSync(runs)) {
        if (name === '.gitkeep') continue
        rmSync(join(runs, name), { recursive: true, force: true })
        wiped++
      }
    }
  }
}

// Reset the generated single-file state.
writeFileSync(
  join(AGENT_LOOP_ROOT, 'orchestrator', 'dispatch-log.md'),
  '<!-- Dispatch ledger — one line per dispatched item: `- <item-slug> -> pass|fail (<summary>)`. Newest at the bottom. Machinery appends here. -->\n'
)
writeFileSync(join(AGENT_LOOP_ROOT, 'memory', 'run-metrics.jsonl'), '')
const heartbeat = join(AGENT_LOOP_ROOT, 'orchestrator', '.heartbeat')
if (existsSync(heartbeat)) rmSync(heartbeat)

log(`✔ Instance data reset (${wiped} stale item(s) cleared).`)

// --- 3. report pipeline prose that still names the origin project --------
// Walk every .md under agent-loop and flag files containing origin vocabulary.
function walkMarkdown(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const info = statSync(full)
    if (info.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue
      walkMarkdown(full, out)
    } else if (name.endsWith('.md')) {
      out.push(full)
    }
  }
}

const allMd = []
walkMarkdown(AGENT_LOOP_ROOT, allMd)

const needsReview = []
for (const file of allMd) {
  const text = readFileSync(file, 'utf8').toLowerCase()
  const hits = ORIGIN_TERMS.filter((term) => text.includes(term.toLowerCase()))
  if (hits.length > 0) {
    needsReview.push({ file: relative(AGENT_LOOP_ROOT, file), hits })
  }
}

if (needsReview.length === 0) {
  log('✔ No origin-project vocabulary found — pipelines look project-neutral.')
} else {
  log(`\n⚠ ${needsReview.length} file(s) still describe the origin project. Adapt these to your stack:`)
  for (const { file, hits } of needsReview) {
    log(`   • ${file}  (${hits.join(', ')})`)
  }
  log('\n   These are the pipeline PROSE (examples, references) — the machinery is generic.')
  log('   Edit the wording to match your framework/DB/auth. The loop still runs before you do.')
}

// --- next steps -----------------------------------------------------------
log('\nNext:')
log('  • Start a first work item:  drop a note in orchestrator/inbox/  (see orchestrator/orchestrator.md)')
log('  • Run one tick:             node agent-loop/orchestrator/tick.mjs')
log('  • Read the entry point:     agent-loop/agent-loop.md')
