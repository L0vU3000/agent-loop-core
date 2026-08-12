#!/usr/bin/env node
// init.mjs — adopt the agent-loop into a project.
//
// What it does:
//   1. Confirms this folder sits one level under a repo root (the machinery
//      resolves the repo as its own parent directory).
//   2. Resets all instance data to an empty slate (safe to re-run — idempotent).
//   3. Checks whether STACK.md has been filled in — the one file that tells the
//      pipelines what your database / ORM / auth / services layer actually are.
//
// Run once, from inside the agent-loop folder, right after you copy it in:
//   node init.mjs
//
// Pure Node built-ins — no npm install.

import { readdirSync, existsSync, rmSync, writeFileSync, statSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT_LOOP_ROOT = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(AGENT_LOOP_ROOT, '..')

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

// Every queue directory, not just the ones that existed first. A stale claim or a proposed edge
// carried into a fresh project is instance data pretending to be work — in-progress/ would wedge
// an item nobody is running, next/ would offer a hand-off from a predecessor that no longer exists.
let wiped = 0
wiped += clearMarkdown(join(AGENT_LOOP_ROOT, 'orchestrator', 'inbox'))
wiped += clearMarkdown(join(AGENT_LOOP_ROOT, 'orchestrator', 'inbox', 'done'))
wiped += clearMarkdown(join(AGENT_LOOP_ROOT, 'orchestrator', 'inbox', 'failed'))
wiped += clearMarkdown(join(AGENT_LOOP_ROOT, 'orchestrator', 'inbox', 'in-progress'))
wiped += clearMarkdown(join(AGENT_LOOP_ROOT, 'orchestrator', 'inbox', 'next'))
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

// --- 3. install the project-level Claude command -------------------------
// The template is copied into <project>/agent-loop, but Claude Code discovers commands only from
// <project>/.claude/commands. Install the bundled entry point on first adoption without ever
// overwriting a command the consuming project has customized.
const bundledOrchestrateCommand = join(AGENT_LOOP_ROOT, '.claude', 'commands', 'orchestrate.md')
const projectOrchestrateCommand = join(REPO_ROOT, '.claude', 'commands', 'orchestrate.md')
if (existsSync(bundledOrchestrateCommand)) {
  if (existsSync(projectOrchestrateCommand)) {
    log('ℹ Kept existing project command: .claude/commands/orchestrate.md')
  } else {
    mkdirSync(dirname(projectOrchestrateCommand), { recursive: true })
    copyFileSync(bundledOrchestrateCommand, projectOrchestrateCommand)
    log('✔ Installed Claude command: .claude/commands/orchestrate.md')
  }
}

// --- 4. check STACK.md has been filled in --------------------------------
// The pipelines refer to your stack by role (database, ORM, auth, services layer).
// STACK.md is the one file mapping each role to the concrete tool/path in THIS
// project. Its table ships with the middle column blank; flag rows still empty.
const stackPath = join(AGENT_LOOP_ROOT, 'STACK.md')
if (!existsSync(stackPath)) {
  log('⚠ STACK.md is missing — pipelines have nowhere to look up your stack. Restore it.')
} else {
  const rows = readFileSync(stackPath, 'utf8').split('\n')
  // A stack row looks like: | Role | This project | Example |
  // Count rows whose middle cell (the "fill in" column) is blank.
  const blankRows = rows.filter((line) => {
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 5) {
      return false
    }

    // cells[0] and cells[last] are the line's outer edges (empty); real cells are the middle.
    const role = cells[1]
    const projectValue = cells[2]
    if (role.length === 0) {
      return false
    }

    const isHeaderOrDivider = /^(Role|-+|:?-+:?)$/i.test(role) || role.startsWith('Role ')
    return !isHeaderOrDivider && projectValue.length === 0
  })
  if (blankRows.length === 0) {
    log('✔ STACK.md looks filled in.')
  } else {
    log(`\n⚠ STACK.md has ${blankRows.length} role(s) not yet filled in. The pipelines defer to it —`)
    log('   set the middle column for your database, ORM, auth, services layer, etc. before running:')
    log('   → ' + join('agent-loop', 'STACK.md'))
  }
}

// --- next steps -----------------------------------------------------------
log('\nNext:')
log('  • Fill in STACK.md:         agent-loop/STACK.md  (your database / ORM / auth / paths)')
log('  • Use Claude intake:        /orchestrate <request>  (after reopening Claude Code)')
log('  • Start a first work item:  drop a note in orchestrator/inbox/  (see orchestrator/orchestrator.md)')
log('  • Run one tick:             node agent-loop/orchestrator/tick.mjs')
log('  • Read the entry point:     agent-loop/agent-loop.md')
