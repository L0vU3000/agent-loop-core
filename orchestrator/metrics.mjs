#!/usr/bin/env node

// Metrics collector — harvest the per-run / per-stage telemetry the built-in Workflow runtime
// ALREADY writes, into a durable ledger we can tune against. No workflow instrumentation, no
// in-script clock (the runtime bans Date.now() anyway) — this just reads what exists.
//
// The runtime writes one JSON per workflow run at
//   ~/.claude/projects/<project>/<session>/workflows/wf_*.json
// with run-level cost (durationMs, totalTokens, totalToolCalls) and a workflowProgress array
// carrying one entry per stage: { label, model, tokens, durationMs, toolCalls, attempt, ... }.
// We keep the facts (cost + the run's result object) and let the analyzer derive ratios later —
// the golden rule of tuning: never cut cost without the paired quality signal to hold constant.
//
// Usage:
//   node agent-loop/orchestrator/metrics.mjs            # harvest new runs into the ledger
//   node agent-loop/orchestrator/metrics.mjs --summary  # per-pipeline cost roll-up from the ledger

import { existsSync, readFileSync, readdirSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_AGENT_LOOP_ROOT = resolve(SCRIPT_DIRECTORY, '..')

function ledgerPath(agentLoopRoot) {
  return join(agentLoopRoot, 'memory', 'run-metrics.jsonl')
}

// Every wf_*.json the runtime has written for any session of any project. We filter to this repo
// by scriptPath below, so a stray other-project run never lands in our ledger.
function workflowRunFiles() {
  const projectsDirectory = join(homedir(), '.claude', 'projects')
  if (!existsSync(projectsDirectory)) {
    return []
  }

  const files = []
  for (const project of readdirSync(projectsDirectory)) {
    const projectDirectory = join(projectsDirectory, project)
    let sessions
    try {
      sessions = readdirSync(projectDirectory)
    } catch {
      continue
    }
    for (const session of sessions) {
      const workflowsDirectory = join(projectDirectory, session, 'workflows')
      if (!existsSync(workflowsDirectory)) {
        continue
      }
      for (const file of readdirSync(workflowsDirectory)) {
        if (file.startsWith('wf_') && file.endsWith('.json')) {
          files.push(join(workflowsDirectory, file))
        }
      }
    }
  }
  return files
}

// Pure: turn one runtime workflow JSON into a ledger row, or null if it isn't a finished run of
// this repo. This is the piece the regression test drives against a fixture.
export function toRow(workflow, repoRoot) {
  if (!workflow || !workflow.runId) {
    return null
  }
  // Only runs of THIS repo's workflows (scriptPath is absolute).
  if (repoRoot && workflow.scriptPath && !workflow.scriptPath.startsWith(repoRoot)) {
    return null
  }
  // Skip runs that haven't finished — their numbers aren't final yet.
  if (workflow.durationMs == null || workflow.status === 'running') {
    return null
  }

  const stages = (workflow.workflowProgress || [])
    .filter((entry) => entry.type === 'workflow_agent')
    .map((agent) => ({
      label: agent.label,
      phase: agent.phaseTitle,
      model: agent.model,
      tokens: agent.tokens ?? null,
      durationMs: agent.durationMs ?? null,
      toolCalls: agent.toolCalls ?? null,
      attempt: agent.attempt ?? null,
      // time this stage waited for a concurrency slot vs. actually ran — separates a slow model
      // from a saturated queue.
      queueMs: agent.startedAt != null && agent.queuedAt != null ? agent.startedAt - agent.queuedAt : null,
    }))

  const ticket = (workflow.args || '').split(/\s+/).find((part) => part.endsWith('.md')) || ''

  return {
    runId: workflow.runId,
    pipeline: workflow.workflowName || null,
    ticket,
    status: workflow.status || null,
    timestamp: workflow.timestamp || null,
    defaultModel: workflow.defaultModel || null,
    totalTokens: workflow.totalTokens ?? null,
    durationMs: workflow.durationMs ?? null,
    totalToolCalls: workflow.totalToolCalls ?? null,
    agentCount: workflow.agentCount ?? null,
    // convergence proxy: one eval stage per plan→execute→eval lap.
    iterations: stages.filter((stage) => /^eval/.test(stage.label || '')).length,
    // the run's own return value — the quality/outcome facts (fixed/built, verdict, counts). Kept
    // whole so the analyzer decides convergence; we store facts, not interpretations.
    result: workflow.result ?? null,
    stages,
  }
}

function ledgeredRunIds(ledger) {
  const seen = new Set()
  if (!existsSync(ledger)) {
    return seen
  }
  for (const line of readFileSync(ledger, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue
    }
    try {
      seen.add(JSON.parse(line).runId)
    } catch {
      // a corrupt line shouldn't stop the harvest — skip it.
    }
  }
  return seen
}

// Append every finished run not already in the ledger. Idempotent: safe to call after every
// --record, so the ledger fills itself as real app work runs.
export function collectMetrics(agentLoopRoot = DEFAULT_AGENT_LOOP_ROOT, repoRoot = resolve(agentLoopRoot, '..')) {
  const ledger = ledgerPath(agentLoopRoot)
  const seen = ledgeredRunIds(ledger)

  const rows = []
  for (const file of workflowRunFiles()) {
    let workflow
    try {
      workflow = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    if (seen.has(workflow.runId)) {
      continue
    }
    const row = toRow(workflow, repoRoot)
    if (!row) {
      continue
    }
    rows.push(row)
    seen.add(workflow.runId)
  }

  rows.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
  for (const row of rows) {
    appendFileSync(ledger, `${JSON.stringify(row)}\n`)
  }
  return { added: rows.length, ledger }
}

function readLedgerRows(ledger) {
  if (!existsSync(ledger)) {
    return []
  }
  const rows = []
  for (const line of readFileSync(ledger, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue
    }
    try {
      rows.push(JSON.parse(line))
    } catch {
      // skip corrupt line
    }
  }
  return rows
}

// A compact per-pipeline roll-up so the ledger is useful the moment it has rows: average cost per
// run and where the tokens go by stage. This is the "where to cut" signal.
function printSummary(agentLoopRoot) {
  const rows = readLedgerRows(ledgerPath(agentLoopRoot))
  if (rows.length === 0) {
    process.stdout.write('metrics: ledger is empty — run a pipeline, then --record to harvest.\n')
    return
  }

  const byPipeline = new Map()
  for (const row of rows) {
    const key = row.pipeline || '(unknown)'
    if (!byPipeline.has(key)) {
      byPipeline.set(key, [])
    }
    byPipeline.get(key).push(row)
  }

  const round = (value) => (value == null ? '—' : Math.round(value).toLocaleString())
  process.stdout.write(`metrics summary — ${rows.length} run(s)\n`)
  for (const [pipeline, pipelineRows] of [...byPipeline].sort()) {
    const runs = pipelineRows.length
    const avgTokens = pipelineRows.reduce((sum, r) => sum + (r.totalTokens || 0), 0) / runs
    const avgSeconds = pipelineRows.reduce((sum, r) => sum + (r.durationMs || 0), 0) / runs / 1000
    const avgIterations = pipelineRows.reduce((sum, r) => sum + (r.iterations || 0), 0) / runs
    process.stdout.write(
      `\n${pipeline}  (${runs} run${runs === 1 ? '' : 's'})  avg ${round(avgTokens)} tok · ${round(avgSeconds)}s · ${avgIterations.toFixed(1)} iters\n`,
    )

    // tokens by stage-type (explore / plan / execute / eval) — collapse the #N suffix.
    const byStage = new Map()
    for (const row of pipelineRows) {
      for (const stage of row.stages || []) {
        const kind = (stage.label || '').replace(/#\d+$/, '').replace(/\d+$/, '') || '(stage)'
        if (!byStage.has(kind)) {
          byStage.set(kind, { tokens: 0, models: new Set() })
        }
        const bucket = byStage.get(kind)
        bucket.tokens += stage.tokens || 0
        if (stage.model) {
          bucket.models.add(stage.model.replace(/\[.*\]$/, ''))
        }
      }
    }
    for (const [kind, bucket] of byStage) {
      process.stdout.write(`    ${kind.padEnd(10)} ${round(bucket.tokens).padStart(9)} tok  [${[...bucket.models].join(', ')}]\n`)
    }
  }
}

function runCli() {
  const agentLoopRoot = DEFAULT_AGENT_LOOP_ROOT
  if (process.argv.includes('--summary')) {
    printSummary(agentLoopRoot)
    return
  }
  const { added, ledger } = collectMetrics(agentLoopRoot)
  process.stdout.write(`metrics: harvested ${added} new run(s) -> ${ledger}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  runCli()
}
