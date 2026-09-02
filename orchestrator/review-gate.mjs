#!/usr/bin/env node

// Review gate — the durable human UI/UX approval gate. Persists review-packet submissions and
// their approve/reject decisions under agent-loop state
// (orchestrator/review-gate/<run-id>.json). Deterministic, zero-token, zero-dependency code —
// provider-neutral: sending the packet to Telegram is a runtime-agent concern (it has the
// messaging tool), this module only records the durable submission/decision.
//
// Contract:
//   - a submission binds a run id + the EXACT git commit SHA + the evidence (screenshot/artifact
//     paths, routes, viewports) to one SHA-256 digest. Approval/rejection must cite that exact
//     commit + digest — free-text notes are commentary, not evidence, and are excluded from the
//     digest.
//   - only a `pending` submission can be decided. Deciding twice, or against stale evidence (a
//     newer submission replaced it, or the citation doesn't match), is refused with a specific
//     reason. Rejection requires feedback.
//   - a fresh submission always resets status to `pending` — this is the one way back into
//     review after a rejection, or after a new commit makes a prior pending packet stale. The
//     record is keyed by run id: one active packet per run.
//
// Usage:
//   node agent-control-plane/orchestrator/review-gate.mjs --submit --run <id> --commit <sha>
//     --artifact <path> [--artifact <path> ...] --route <route> [--route <route> ...]
//     --viewport <viewport> [--viewport <viewport> ...] [--notes "..."]
//   node agent-control-plane/orchestrator/review-gate.mjs --approve --run <id> --commit <sha> --digest <digest>
//   node agent-control-plane/orchestrator/review-gate.mjs --reject  --run <id> --commit <sha> --digest <digest> --feedback "..."
//   node agent-control-plane/orchestrator/review-gate.mjs --status  --run <id> [--json]

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_AGENT_LOOP_ROOT = resolve(SCRIPT_DIRECTORY, '..')

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i

function stateDirectory(agentLoopRoot) {
  return join(agentLoopRoot, 'orchestrator', 'review-gate')
}

function recordPath(agentLoopRoot, runId) {
  return join(stateDirectory(agentLoopRoot), `${runId}.json`)
}

function assertRunId(runId) {
  if (!runId || typeof runId !== 'string' || /[\\/]/.test(runId) || runId === '.' || runId === '..') {
    throw new Error(`runId must be a plain non-empty identifier, got "${runId}"`)
  }
}

function assertCommitSha(commitSha) {
  if (!COMMIT_SHA_PATTERN.test(commitSha || '')) {
    throw new Error(`commitSha must be the exact 40-character git commit SHA, got "${commitSha}"`)
  }
}

function assertNonEmptyStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`${label} must be a non-empty array of non-empty strings`)
  }
}

// Pure: the digest binds the packet's evidentiary content — which run, which exact commit, and
// what was captured. Free-text notes are commentary, not evidence, so they are deliberately
// excluded: editing a note must never invalidate a still-accurate approval citation.
export function computeDigest({ runId, commitSha, artifacts, routes, viewports }) {
  const canonical = JSON.stringify({
    runId,
    commitSha: (commitSha || '').toLowerCase(),
    artifacts,
    routes,
    viewports,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function loadRecord(agentLoopRoot, runId) {
  const path = recordPath(agentLoopRoot, runId)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

function saveRecord(agentLoopRoot, record) {
  mkdirSync(stateDirectory(agentLoopRoot), { recursive: true })
  writeFileSync(recordPath(agentLoopRoot, record.runId), `${JSON.stringify(record, null, 2)}\n`)
}

// Persist (or replace) the pending review packet for one run. Always resets status to
// `pending` — the one way back into review after a rejection, or after new evidence (a new
// commit) makes a prior pending packet stale.
export function submitReview(agentLoopRoot, { runId, commitSha, artifacts, routes, viewports, notes = '' }) {
  assertRunId(runId)
  assertCommitSha(commitSha)
  assertNonEmptyStringArray(artifacts, 'artifacts')
  assertNonEmptyStringArray(routes, 'routes')
  assertNonEmptyStringArray(viewports, 'viewports')

  const normalizedCommitSha = commitSha.toLowerCase()
  const digest = computeDigest({ runId, commitSha: normalizedCommitSha, artifacts, routes, viewports })
  const now = new Date().toISOString()
  const previous = loadRecord(agentLoopRoot, runId)

  const historyEntry = { at: now, event: previous ? 'resubmitted' : 'submitted', commitSha: normalizedCommitSha, digest }
  if (previous && previous.status === 'pending' && previous.digest !== digest) {
    historyEntry.note = `superseded pending submission at commit ${previous.commitSha}`
  } else if (previous && previous.status !== 'pending') {
    historyEntry.note = `reopened after ${previous.status}`
  }

  const record = {
    runId,
    commitSha: normalizedCommitSha,
    artifacts,
    routes,
    viewports,
    notes,
    digest,
    status: 'pending',
    createdAt: previous ? previous.createdAt : now,
    updatedAt: now,
    decidedAt: null,
    feedback: null,
    history: [...(previous ? previous.history : []), historyEntry],
  }

  saveRecord(agentLoopRoot, record)
  return record
}

// Decide a pending submission. Accepts ONLY the exact pending submission's current commit +
// digest — any mismatch (stale evidence, wrong commit, tampering) or any decision recorded
// after a prior decision is refused with a specific, actionable reason.
export function decideReview(agentLoopRoot, { runId, commitSha, digest, decision, feedback = '' }) {
  assertRunId(runId)
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error(`decision must be "approved" or "rejected", got "${decision}"`)
  }
  if (decision === 'rejected' && !feedback.trim()) {
    throw new Error('rejection requires feedback')
  }

  const record = loadRecord(agentLoopRoot, runId)
  if (!record) {
    throw new Error(`no review submission found for run "${runId}"`)
  }
  if (record.status !== 'pending') {
    throw new Error(`run "${runId}" was already decided (${record.status}) — a fresh submission is required to reopen review`)
  }

  const normalizedCommitSha = (commitSha || '').toLowerCase()
  if (record.commitSha !== normalizedCommitSha || record.digest !== digest) {
    throw new Error(
      `stale or mismatched evidence for run "${runId}" — the pending submission is at commit `
      + `${record.commitSha} (digest ${record.digest}), not commit ${commitSha || '(none)'} (digest ${digest || '(none)'})`,
    )
  }

  const now = new Date().toISOString()
  record.status = decision
  record.updatedAt = now
  record.decidedAt = now
  record.feedback = decision === 'rejected' ? feedback : null
  record.history.push({ at: now, event: decision, commitSha: record.commitSha, digest: record.digest, feedback: record.feedback })

  saveRecord(agentLoopRoot, record)
  return record
}

export function getReview(agentLoopRoot, runId) {
  assertRunId(runId)
  return loadRecord(agentLoopRoot, runId)
}

// --- CLI --------------------------------------------------------------------------------------

function collectRepeatable(args, flag) {
  const values = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) values.push(args[i + 1])
  }
  return values
}

function singleValue(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

function cliRoot(args) {
  const rootOption = args.find((argument) => argument.startsWith('--root='))
  return rootOption ? resolve(rootOption.slice('--root='.length)) : DEFAULT_AGENT_LOOP_ROOT
}

function runCli() {
  const args = process.argv.slice(2)
  const root = cliRoot(args)

  try {
    if (args.includes('--submit')) {
      const record = submitReview(root, {
        runId: singleValue(args, '--run'),
        commitSha: singleValue(args, '--commit'),
        artifacts: collectRepeatable(args, '--artifact'),
        routes: collectRepeatable(args, '--route'),
        viewports: collectRepeatable(args, '--viewport'),
        notes: singleValue(args, '--notes') || '',
      })
      process.stdout.write(`submitted: run ${record.runId} at commit ${record.commitSha}\n`)
      process.stdout.write(`digest: ${record.digest}\n`)
      process.stdout.write(`status: ${record.status}\n`)
      return
    }

    if (args.includes('--approve') || args.includes('--reject')) {
      const decision = args.includes('--approve') ? 'approved' : 'rejected'
      const record = decideReview(root, {
        runId: singleValue(args, '--run'),
        commitSha: singleValue(args, '--commit'),
        digest: singleValue(args, '--digest'),
        decision,
        feedback: singleValue(args, '--feedback') || '',
      })
      process.stdout.write(`${record.status}: run ${record.runId} at commit ${record.commitSha}\n`)
      if (record.feedback) process.stdout.write(`feedback: ${record.feedback}\n`)
      return
    }

    if (args.includes('--status')) {
      const runId = singleValue(args, '--run')
      const record = getReview(root, runId)
      if (!record) {
        process.stdout.write(`no review submission found for run "${runId}"\n`)
        process.exitCode = 1
        return
      }
      if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(record, null, 2)}\n`)
      } else {
        process.stdout.write(`run ${record.runId}: ${record.status} (commit ${record.commitSha}, digest ${record.digest})\n`)
        if (record.feedback) process.stdout.write(`feedback: ${record.feedback}\n`)
      }
      return
    }

    process.stderr.write(
      'usage: review-gate.mjs --submit --run <id> --commit <sha> --artifact <path> [...] --route <r> [...] --viewport <v> [...] [--notes "..."]\n'
      + '       review-gate.mjs --approve --run <id> --commit <sha> --digest <digest>\n'
      + '       review-gate.mjs --reject  --run <id> --commit <sha> --digest <digest> --feedback "..."\n'
      + '       review-gate.mjs --status  --run <id> [--json]\n',
    )
    process.exitCode = 1
  } catch (error) {
    process.stderr.write(`review-gate: ${error.message}\n`)
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  runCli()
}
