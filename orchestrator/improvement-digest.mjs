#!/usr/bin/env node

// Improvement digest — the half-open feedback loop. Monitoring is already automatic (metrics.mjs
// harvests every run into memory/run-metrics.jsonl); this projection turns that ledger PLUS every
// pipeline's eval scorecard into ONE ranked backlog: memory/improvement-candidates.md.
//
// Deliberately NOT a closed loop. It collects and ranks the signal; a human reads the backlog and
// decides when to run `pipeline-improve`. Nothing here triggers a fix. Like update-dashboard.sh,
// the output is a pure re-derivable snapshot of state that already exists — it can't drift, and
// needs no pruning (the raw history lives in run-metrics.jsonl and the runs/ folders).
//
// Usage:
//   node agent-loop/orchestrator/improvement-digest.mjs           # rewrite the backlog snapshot
//   node agent-loop/orchestrator/improvement-digest.mjs --print   # print it instead of writing

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_AGENT_LOOP_ROOT = resolve(SCRIPT_DIRECTORY, '..')

// --- pure signal extraction (this is what the regression test drives) ---------------------

// Pull the scoring facts out of a runs/<id>/eval.md. Tolerant of both the old plain format
// (verdict line only) and the current scorecard block (score/threshold/critical-failures).
// Missing fields come back null rather than guessed.
export function parseEvalScorecard(text) {
  const grab = (pattern) => {
    const match = (text || '').match(pattern)
    return match ? match[1] : null
  }
  const verdict = grab(/verdict:\s*(pass|fail)/i)
  const score = grab(/score:\s*(\d+)\s*\/\s*\d+/i)
  const threshold = grab(/threshold:\s*(\d+)/i)
  const criticalFailures = grab(/critical-failures:\s*(\d+)/i)
  return {
    verdict: verdict ? verdict.toLowerCase() : null,
    score: score == null ? null : Number(score),
    threshold: threshold == null ? null : Number(threshold),
    criticalFailures: criticalFailures == null ? null : Number(criticalFailures),
  }
}

// One eval scorecard -> a candidate {severity, where, what}, or null if it passed cleanly.
export function evalCandidate(evalRecord) {
  const reasons = []
  let severity = 0
  if (evalRecord.verdict === 'fail') {
    severity = Math.max(severity, 90)
    reasons.push('eval verdict: fail')
  }
  if (evalRecord.criticalFailures != null && evalRecord.criticalFailures > 0) {
    severity = Math.max(severity, 90)
    reasons.push(`${evalRecord.criticalFailures} critical failure(s)`)
  }
  if (evalRecord.score != null && evalRecord.threshold != null && evalRecord.score < evalRecord.threshold) {
    severity = Math.max(severity, 80)
    reasons.push(`score ${evalRecord.score} below threshold ${evalRecord.threshold}`)
  }
  if (reasons.length === 0) {
    return null
  }
  return { severity, where: `${evalRecord.pipeline} · run ${evalRecord.run}`, what: reasons.join('; ') }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// The metrics ledger rows -> candidates. Approval-gated pauses (agentCount>0, stages present,
// awaiting* result) are normal, not weaknesses, so they are NOT flagged. We flag only hard
// failures, aborted runs, poor convergence, and cost outliers.
export function runCandidates(runs) {
  // per-pipeline median tokens, only meaningful once a pipeline has a few finished runs.
  const tokensByPipeline = new Map()
  for (const run of runs) {
    const tokens = run.totalTokens || 0
    if (tokens <= 0) {
      continue
    }
    if (!tokensByPipeline.has(run.pipeline)) {
      tokensByPipeline.set(run.pipeline, [])
    }
    tokensByPipeline.get(run.pipeline).push(tokens)
  }
  const medianTokens = new Map()
  for (const [pipeline, tokens] of tokensByPipeline) {
    if (tokens.length >= 3) {
      medianTokens.set(pipeline, median(tokens))
    }
  }

  const candidates = []
  for (const run of runs) {
    const reasons = []
    let severity = 0

    // A machinery startup crash — 0 agents, 0 stages, sub-second — always records status "failed"
    // (the Workflow runtime marks a load-time throw failed, not completed). Key on that SHAPE so it
    // reads distinctly from a real modeling failure that burned tokens and ran stages, rather than
    // vanishing into the generic "run failed" message. Checked independently of the status branch.
    const looksLikeStartupCrash =
      (run.agentCount || 0) === 0 && (run.stages || []).length === 0 && (run.durationMs || 0) < 1000

    if (run.status === 'failed') {
      severity = Math.max(severity, 100)
      if (looksLikeStartupCrash) {
        reasons.push('machinery startup crash — 0 stages ran before any agent started')
      } else {
        reasons.push('run failed (status: failed)')
      }
    } else if (looksLikeStartupCrash) {
      // finished "completed" but did no work — an abort before the first stage.
      severity = Math.max(severity, 70)
      reasons.push('run aborted before doing any work')
    }

    if ((run.iterations || 0) >= 2) {
      severity = Math.max(severity, 40)
      reasons.push(`${run.iterations} eval laps to converge`)
    }

    const med = medianTokens.get(run.pipeline)
    if (med && (run.totalTokens || 0) > 2 * med) {
      severity = Math.max(severity, 30)
      reasons.push(`cost outlier: ${run.totalTokens.toLocaleString()} tok vs ~${Math.round(med).toLocaleString()} median`)
    }

    if (reasons.length > 0) {
      candidates.push({ severity, where: `${run.pipeline} · ${run.runId}`, what: reasons.join('; ') })
    }
  }
  return candidates
}

// The dispatch ledger -> candidates. The one signal we care about here is a DOORWAY DOWNGRADE:
// the record gate re-verified a claimed PASS and overruled it to fail (dispatch.mjs decideRecord
// writes the marker below). That is the exact failure mode the eval/metrics streams are blind to —
// the pipeline's own eval said pass, the objective gate disagreed — so it ranks above an eval fail.
export function dispatchCandidates(logText) {
  const candidates = []
  for (const line of (logText || '').split('\n')) {
    const match = line.match(/^- (.+?) -> fail \((verdict overruled by record gate:.*)\)\s*$/)
    if (match) {
      candidates.push({ severity: 95, where: `doorway · ${match[1]}`, what: match[2] })
    }
  }
  return candidates
}

// Machinery self-check status -> a single top-priority candidate when the last run FAILED. The tools
// guard every pipeline, so a broken machinery check outranks any per-run weakness. A pass or a
// never-run status flags nothing here — it is still shown verbatim in the Machinery section so a
// clean backlog is trustworthy and a stale green is visible by its timestamp.
export function machineryCandidate(status) {
  if (!status || status.verdict !== 'fail') {
    return null
  }
  return {
    severity: 100,
    where: 'machinery · check-machinery.sh',
    what: `machinery self-check FAILED${status.when ? ` (last run ${status.when})` : ''} — scaffolding guarding every pipeline is broken`,
  }
}

function severityIcon(severity) {
  if (severity >= 90) {
    return '🔴'
  }
  if (severity >= 50) {
    return '🟠'
  }
  return '🟡'
}

// Assemble the whole backlog snapshot from already-parsed inputs. Pure: no filesystem, no clock —
// `now` is passed in (the runtime bans Date.now() in scripts; the CLI supplies a real stamp).
// ponytail: eval-side and metrics-side candidates are two independent streams keyed differently
// (run folder vs wf id), so a hard failure can list twice with different "where". Acceptable —
// join them on result.runId only if the duplication ever gets noisy.
export function buildDigest({ runs = [], evals = [], errors = { count: 0, latest: null }, dispatch = '', machinery = null, now }) {
  const candidates = [
    machineryCandidate(machinery),
    ...evals.map(evalCandidate).filter(Boolean),
    ...runCandidates(runs),
    ...dispatchCandidates(dispatch),
  ].filter(Boolean).sort((a, b) => b.severity - a.severity || a.where.localeCompare(b.where))

  const lines = []
  lines.push('# Improvement candidates')
  lines.push('')
  lines.push('> Generated by `orchestrator/improvement-digest.mjs` — **do not hand-edit**, it is overwritten each tick.')
  lines.push('> A read-only backlog: monitoring surfaces the signal; **you** decide when to run `pipeline-improve`.')
  lines.push('> Nothing here triggers a fix automatically.')
  lines.push(`> Last updated: **${now}**`)
  lines.push('')

  lines.push(`## Signals (${candidates.length})`)
  lines.push('')
  if (candidates.length === 0) {
    lines.push('- _No candidates — every recorded run passed cleanly and converged._')
  } else {
    lines.push('| Severity | Where | What |')
    lines.push('|---|---|---|')
    for (const candidate of candidates) {
      lines.push(`| ${severityIcon(candidate.severity)} ${candidate.severity} | ${candidate.where} | ${candidate.what} |`)
    }
  }
  lines.push('')

  lines.push('## Machinery self-check')
  lines.push('')
  if (!machinery || machinery.verdict == null) {
    lines.push('- _No `check-machinery.sh` run recorded yet._')
  } else {
    const icon = machinery.verdict === 'fail' ? '🔴 FAILED' : '🟢 passed'
    lines.push(`- Last run: ${icon}${machinery.when ? ` — ${machinery.when}` : ''}`)
  }
  lines.push('')

  lines.push('## Recorded lessons')
  lines.push('')
  if (errors.count > 0) {
    lines.push(`- \`memory/errors.md\` holds **${errors.count}** entr${errors.count === 1 ? 'y' : 'ies'}.`)
    if (errors.latest) {
      lines.push(`- Newest: ${errors.latest}`)
    }
  } else {
    lines.push('- _No lessons recorded yet._')
  }
  lines.push('')
  return lines.join('\n')
}

// --- CLI: gather the files, then hand the pure builder already-parsed inputs -----------------

function readLedger(agentLoopRoot) {
  const ledger = join(agentLoopRoot, 'memory', 'run-metrics.jsonl')
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
      // skip a corrupt line rather than abort the digest.
    }
  }
  return rows
}

function readEvals(agentLoopRoot) {
  const pipelinesDirectory = join(agentLoopRoot, 'pipelines')
  if (!existsSync(pipelinesDirectory)) {
    return []
  }
  const evals = []
  for (const pipeline of readdirSync(pipelinesDirectory)) {
    const runsDirectory = join(pipelinesDirectory, pipeline, 'runs')
    if (!existsSync(runsDirectory)) {
      continue
    }
    for (const run of readdirSync(runsDirectory)) {
      const evalFile = join(runsDirectory, run, 'eval.md')
      if (!existsSync(evalFile)) {
        continue
      }
      const parsed = parseEvalScorecard(readFileSync(evalFile, 'utf8'))
      evals.push({ pipeline, run, ...parsed })
    }
  }
  return evals
}

function readErrors(agentLoopRoot) {
  const errorsFile = join(agentLoopRoot, 'memory', 'errors.md')
  if (!existsSync(errorsFile)) {
    return { count: 0, latest: null }
  }
  const text = readFileSync(errorsFile, 'utf8')
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim())
  return { count: headings.length, latest: headings[headings.length - 1] || null }
}

function readDispatchLog(agentLoopRoot) {
  const logFile = join(agentLoopRoot, 'orchestrator', 'dispatch-log.md')
  return existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
}

// check-machinery.sh drops a one-line "<pass|fail> <iso-timestamp>" stamp on every run. Reading it
// (rather than re-running the heavy self-check) keeps this digest pure and cheap, and the timestamp
// makes a stale green visible.
function readMachineryStatus(agentLoopRoot) {
  const statusFile = join(agentLoopRoot, 'memory', 'machinery-status.txt')
  if (!existsSync(statusFile)) {
    return null
  }
  const match = readFileSync(statusFile, 'utf8').trim().match(/^(pass|fail)\s+(.*)$/)
  return match ? { verdict: match[1], when: match[2] || null } : null
}

function runCli(agentLoopRoot = DEFAULT_AGENT_LOOP_ROOT) {
  const digest = buildDigest({
    runs: readLedger(agentLoopRoot),
    evals: readEvals(agentLoopRoot),
    errors: readErrors(agentLoopRoot),
    dispatch: readDispatchLog(agentLoopRoot),
    machinery: readMachineryStatus(agentLoopRoot),
    now: new Date().toISOString().replace('T', ' ').slice(0, 16),
  })
  if (process.argv.includes('--print')) {
    process.stdout.write(`${digest}\n`)
    return
  }
  const out = join(agentLoopRoot, 'memory', 'improvement-candidates.md')
  writeFileSync(out, `${digest}\n`)
  process.stdout.write(`improvement-digest: wrote ${out}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  runCli()
}
