#!/usr/bin/env node

// Orchestrator dispatcher — one tick of the router described in orchestrator.md.
//
// What it does (deterministic, zero-token code — "code is the unsung hero"):
//   read inbox/*.md  ->  validate category+type against the canonical registry
//   ->  select the pipeline  ->  emit the dispatch plan in priority order.
//
// What it does NOT do: run a pipeline. A pipeline is a `workflow.js` executed by the
// built-in Workflow runtime (the harness), which a plain node process cannot invoke.
// So the dispatcher ROUTES and RECORDS; the runtime EXECUTES the emitted plan. That is
// exactly the spec's "it routes, it does not do the work itself".
//
// Registry source of truth: pipeline.md frontmatter, loaded via the same validator the
// machinery self-check uses (no second copy of the routing table to drift).
//
// Usage:
//   node agent-loop/orchestrator/dispatch.mjs            # print the dispatch plan
//   node agent-loop/orchestrator/dispatch.mjs --json     # machine-readable plan
//   node agent-loop/orchestrator/dispatch.mjs --claim <file>
//                                                        # mark an item in-progress (atomic move
//                                                        # into inbox/in-progress/) so a second
//                                                        # concurrent tick cannot re-dispatch it.
//   node agent-loop/orchestrator/dispatch.mjs --reclaim <file>
//                                                        # return a STALE claim to the inbox so it
//                                                        # can be dispatched again (refuses a claim
//                                                        # younger than the staleness threshold).
//   node agent-loop/orchestrator/dispatch.mjs --record <file> <pass|fail> [--summary "..."]
//                                                        # finalize a run: move + changelog
//                                                        # a claimed PASS on a code-changing
//                                                        # pipeline is re-verified here (fast
//                                                        # objective gates); add --skip-gate to
//                                                        # bypass for a quick manual record.

import { existsSync, readFileSync, readdirSync, renameSync, mkdirSync, appendFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { validatePipelineRegistry } from '../scripts/check-pipeline-registry.mjs'
import { collectMetrics } from './metrics.mjs'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_AGENT_LOOP_ROOT = resolve(SCRIPT_DIRECTORY, '..')

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 }

// A work item's frontmatter is a small subset — never require a `name` (that is a pipeline
// concept, not an inbox concept). Missing or malformed frontmatter is a validation result,
// not a crash. Exported so the work-item checker validates against the SAME parser the router
// uses — one source of truth, no drift.
export function parseItemFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/)
  if (!match) {
    return null
  }

  const metadata = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) {
      continue
    }
    const key = line.slice(0, separator).trim()
    metadata[key] = line.slice(separator + 1).trim()
  }
  return metadata
}

function inboxItemFiles(inboxDirectory) {
  if (!existsSync(inboxDirectory)) {
    return []
  }

  // Top-level *.md only. done/ and failed/ are archives, not pending work.
  return readdirSync(inboxDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
}

// Pure planner: given the agent-loop root, return the routing decision for every inbox item.
// No side effects — this is the piece the regression test drives against fixtures.
export function planDispatch(agentLoopRoot = DEFAULT_AGENT_LOOP_ROOT) {
  const registry = validatePipelineRegistry(agentLoopRoot)
  const byType = new Map(registry.definitions.map((definition) => [definition.type, definition]))

  const inboxDirectory = join(agentLoopRoot, 'orchestrator', 'inbox')
  const items = []

  for (const file of inboxItemFiles(inboxDirectory)) {
    const frontmatter = parseItemFrontmatter(readFileSync(join(inboxDirectory, file), 'utf8'))

    if (!frontmatter || !frontmatter.category || !frontmatter.type) {
      items.push({ file, verdict: 'invalid', reason: 'missing category/type frontmatter' })
      continue
    }

    const { category, type } = frontmatter
    const priority = frontmatter.priority || 'normal'
    const pipeline = byType.get(type)

    if (!pipeline) {
      items.push({ file, category, type, priority, verdict: 'invalid', reason: `no pipeline registered for type "${type}"` })
      continue
    }

    // A category/type mismatch is invalid and returned for correction, never guessed.
    if (pipeline.category !== category) {
      items.push({
        file, category, type, priority, verdict: 'invalid',
        reason: `category "${category}" does not match pipeline ${pipeline.name} (category "${pipeline.category}")`,
      })
      continue
    }

    const workflow = join('pipelines', pipeline.name, 'workflow.js')
    items.push({
      file, category, type, priority, verdict: 'route',
      pipeline: pipeline.name,
      workflow,
      automated: existsSync(join(agentLoopRoot, workflow)),
    })
  }

  const routable = items
    .filter((item) => item.verdict === 'route')
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) || a.file.localeCompare(b.file))
  const invalid = items.filter((item) => item.verdict === 'invalid')

  return {
    registryOk: registry.ok,
    registryErrors: registry.errors,
    items,
    routable,
    invalid,
  }
}

// `file` is an untrusted CLI argument that we join into paths and rename. An inbox item is
// always a plain filename directly under inbox/ (e.g. "10-lint-normal.md"), so anything with a
// directory part or "../" segment is either a bug or a traversal attempt — reject it before it
// can move a file outside the inbox. Shared by recordOutcome, claimItem, and reclaimItem so the
// guard cannot drift between the three places that rename an inbox item.
function assertPlainInboxFilename(file) {
  if (!file || file !== basename(file) || file === '.' || file === '..') {
    throw new Error(`inbox item must be a plain filename, got "${file}"`)
  }
}

// Bookkeeping half of the heartbeat: after the runtime finishes a run, move the item into
// its archive and append the outcome to memory. Additive appends + a file move only.
export function recordOutcome(agentLoopRoot, file, outcome, summary = '') {
  if (outcome !== 'pass' && outcome !== 'fail') {
    throw new Error(`outcome must be "pass" or "fail", got "${outcome}"`)
  }

  assertPlainInboxFilename(file)

  const inboxDirectory = join(agentLoopRoot, 'orchestrator', 'inbox')
  // An item may have been claimed (moved to inbox/in-progress/) between dispatch and record, so
  // look there first and fall back to the top-level inbox for a never-claimed item. This fallback
  // is a no-op for the common, never-claimed case — the top-level path is used exactly as before.
  const claimedSource = join(inboxDirectory, 'in-progress', file)
  const source = existsSync(claimedSource) ? claimedSource : join(inboxDirectory, file)
  if (!existsSync(source)) {
    throw new Error(`inbox item not found: ${file}`)
  }

  const archiveName = outcome === 'pass' ? 'done' : 'failed'
  const archiveDirectory = join(inboxDirectory, archiveName)
  mkdirSync(archiveDirectory, { recursive: true })
  renameSync(source, join(archiveDirectory, file))

  const line = `- ${file} -> ${outcome}${summary ? ` (${summary})` : ''}\n`
  appendFileSync(join(agentLoopRoot, 'orchestrator', 'dispatch-log.md'), line)
  if (outcome === 'fail') {
    appendFileSync(join(agentLoopRoot, 'orchestrator', 'dispatch-log.md'), `  see memory/errors.md\n`)
  }

  return { moved: `inbox/${archiveName}/${file}` }
}

// --- Item claim: mark an item in-progress atomically at dispatch time ------------------------
// orchestrator.md step 2c requires the router to "mark it in-progress" between selecting an item
// and recording its outcome. Without that, two concurrent ticks re-read the same top-level inbox
// and both dispatch the same item (proven live: two back-to-back planDispatch() calls return the
// identical routable set). claimItem closes that window by MOVING the item into inbox/in-progress/
// with a single renameSync — an atomic filesystem operation, so two near-simultaneous claimers
// cannot both succeed (the loser hits ENOENT on the already-moved source). Because inboxItemFiles
// lists only top-level *.md files, a claimed item is invisible to the next planDispatch() for
// free, by the exact same invariant that already hides done/ and failed/.
export function claimItem(agentLoopRoot, file) {
  assertPlainInboxFilename(file)
  const inboxDirectory = join(agentLoopRoot, 'orchestrator', 'inbox')
  const source = join(inboxDirectory, file)
  if (!existsSync(source)) {
    throw new Error(`inbox item not found: ${file}`)
  }
  const inProgressDirectory = join(inboxDirectory, 'in-progress')
  mkdirSync(inProgressDirectory, { recursive: true })
  renameSync(source, join(inProgressDirectory, file))
  return { moved: `inbox/in-progress/${file}` }
}

// A crashed or abandoned run must not wedge an item in inbox/in-progress/ forever. Staleness is a
// wall-clock threshold on the claimed file's mtime. Checked pipelines/*/pipeline.md max-time
// bounds: pipeline-improve/test-coverage/eslint-burndown 45m; bug-fix/feature/api-tool/qa/wiring
// 60m; e2e-regression 90m (the largest). The threshold is the largest bound plus slack — not any
// one pipeline's own bound — because a claim does not record which pipeline owns it.
export const STALE_CLAIM_MS = 120 * 60 * 1000 // 120 minutes: 90m largest pipeline bound + 30m slack

// Deliberate, explicit recovery verb (not automatic inside planDispatch, which stays pure): return
// a STALE claimed item to the top-level inbox so it can be dispatched again. Refuses to touch a
// claim younger than the threshold, so an in-flight run is never yanked out from under itself.
export function reclaimItem(agentLoopRoot, file, staleMs = STALE_CLAIM_MS) {
  assertPlainInboxFilename(file)
  const inboxDirectory = join(agentLoopRoot, 'orchestrator', 'inbox')
  const source = join(inboxDirectory, 'in-progress', file)
  if (!existsSync(source)) {
    throw new Error(`claimed inbox item not found: ${file}`)
  }
  const ageMs = Date.now() - statSync(source).mtimeMs
  if (ageMs < staleMs) {
    throw new Error(`claim on "${file}" is ${Math.round(ageMs / 60000)}m old, not stale (threshold ${Math.round(staleMs / 60000)}m)`)
  }
  // Reclaiming is a heuristic (mtime, not a live liveness signal), so it must never happen
  // silently — a loud stderr line makes a misfire (a still-running claim wrongly returned to the
  // inbox) visible in tick output instead of causing an invisible double-claim.
  process.stderr.write(`reclaim: ${file} claimed ${Math.round(ageMs / 60000)}m ago (> stale threshold ${Math.round(staleMs / 60000)}m) — returning to inbox\n`)
  renameSync(source, join(inboxDirectory, file))
  return { moved: `inbox/${file}` }
}

// --- Record gate: re-verify a claimed PASS at the one doorway --------------------------------
// Every pipeline reports its verdict here, so this is the single place to turn "the sandboxed
// pipeline SAID it passed" into "the machine CONFIRMED it passed" — once, for all pipelines, no
// per-pipeline copy. It can only ever make a verdict STRICTER (downgrade pass→fail); it never
// upgrades a fail, and an environment that can't run the checks is skipped, not failed.

// Pipelines whose exit condition actually produces a compile/test-gateable change. Read-only
// categories (planning, review) and external-state ones (delivery) have nothing local to re-run.
export const GATE_BEARING_CATEGORIES = new Set(['building', 'testing', 'maintenance'])
export function isGateBearing(category) {
  return GATE_BEARING_CATEGORIES.has(category)
}

// The item's declared category, read from the still-present inbox file (before recordOutcome
// moves it). Null when the file or its frontmatter is missing — the caller then skips the gate.
export function itemCategory(agentLoopRoot, file) {
  const inboxDirectory = join(agentLoopRoot, 'orchestrator', 'inbox')
  // Same claimed-first, top-level-second resolution as recordOutcome: a claimed item lives under
  // in-progress/, an unclaimed one directly under inbox/. No-op for the never-claimed case.
  const claimedSource = join(inboxDirectory, 'in-progress', file)
  const source = existsSync(claimedSource) ? claimedSource : join(inboxDirectory, file)
  if (!existsSync(source)) return null
  const frontmatter = parseItemFrontmatter(readFileSync(source, 'utf8'))
  return frontmatter?.category ?? null
}

// Run one objective check. A non-zero EXIT (error.status is a number) means it ran and failed —
// a real signal. A spawn error (no status, e.g. ENOENT) means it could not run — not a failure.
function runCheck(command, commandArgs, cwd) {
  try {
    execFileSync(command, commandArgs, { cwd, stdio: 'ignore' })
    return { ran: true, passed: true }
  } catch (error) {
    if (typeof error.status === 'number') return { ran: true, passed: false }
    return { ran: false, passed: false }
  }
}

// The FAST objective subset: the loop's own machinery self-check + a TypeScript compile. The full
// test suite is deliberately left out of the fast gate (it belongs to a later, opt-in `--full`).
export function runFastGates(agentLoopRoot) {
  const repoRoot = resolve(agentLoopRoot, '..')
  const checks = {
    machinery: runCheck('bash', [join(agentLoopRoot, 'scripts', 'check-machinery.sh')], agentLoopRoot),
    tsc: runCheck('npx', ['tsc', '--noEmit'], repoRoot),
  }
  const executed = Object.entries(checks).filter(([, result]) => result.ran)
  if (executed.length === 0) {
    return { checked: false, passed: false, detail: 'no objective check could run (skipped)' }
  }
  const failed = executed.filter(([, result]) => !result.passed).map(([label]) => label)
  return {
    checked: true,
    passed: failed.length === 0,
    detail: failed.length ? `${failed.join(' + ')} failed` : 'machinery + tsc green',
  }
}

// Pure decision: what outcome to actually record. Safe by construction — only a claimed PASS with
// a gate that ran and FAILED is downgraded; every other case keeps the claimed outcome.
export function decideRecord({ claimed, gate, skipGate }) {
  if (claimed !== 'pass' || skipGate || !gate || !gate.checked) {
    return { outcome: claimed, note: '' }
  }
  if (gate.passed) return { outcome: 'pass', note: '' }
  return { outcome: 'fail', note: `verdict overruled by record gate: ${gate.detail}` }
}

function cliRoot() {
  const rootOption = process.argv.find((argument) => argument.startsWith('--root='))
  return rootOption ? resolve(rootOption.slice('--root='.length)) : DEFAULT_AGENT_LOOP_ROOT
}

function runCli() {
  const args = process.argv.slice(2)
  const root = cliRoot()

  // Claim an item in-progress before running its workflow, so a second concurrent tick cannot
  // re-dispatch it. Atomic move via claimItem; the traversal guard applies exactly as it does to
  // --record.
  const claimIndex = args.indexOf('--claim')
  if (claimIndex !== -1) {
    const file = args[claimIndex + 1]
    if (!file) {
      process.stderr.write('usage: --claim <file>\n')
      process.exitCode = 1
      return
    }
    try {
      const result = claimItem(root, file)
      process.stdout.write(`claimed: moved to ${result.moved}\n`)
    } catch (error) {
      process.stderr.write(`claim failed: ${error.message}\n`)
      process.exitCode = 1
    }
    return
  }

  // Return a STALE claim to the inbox so it can be dispatched again. Refuses a claim that is not
  // yet past the staleness threshold (mirroring the --record usage-error pattern on rejection).
  const reclaimIndex = args.indexOf('--reclaim')
  if (reclaimIndex !== -1) {
    const file = args[reclaimIndex + 1]
    if (!file) {
      process.stderr.write('usage: --reclaim <file>\n')
      process.exitCode = 1
      return
    }
    try {
      const result = reclaimItem(root, file)
      process.stdout.write(`reclaimed: moved to ${result.moved}\n`)
    } catch (error) {
      process.stderr.write(`reclaim failed: ${error.message}\n`)
      process.exitCode = 1
    }
    return
  }

  const recordIndex = args.indexOf('--record')
  if (recordIndex !== -1) {
    const file = args[recordIndex + 1]
    const outcome = args[recordIndex + 2]
    const summaryIndex = args.indexOf('--summary')
    const summary = summaryIndex !== -1 ? args[summaryIndex + 1] : ''
    if (!file || !outcome) {
      process.stderr.write('usage: --record <file> <pass|fail> [--summary "..."] [--skip-gate]\n')
      process.exitCode = 1
      return
    }

    // Re-verify a claimed PASS before trusting it. Only code-changing pipelines have objective
    // gates; read-only ones are recorded as-is. --skip-gate bypasses for a quick manual record.
    const skipGate = args.includes('--skip-gate')
    const category = outcome === 'pass' && !skipGate ? itemCategory(root, file) : null
    const gate = category && isGateBearing(category) ? runFastGates(root) : null
    const decision = decideRecord({ claimed: outcome, gate, skipGate })
    if (decision.outcome !== outcome) {
      process.stderr.write(`record gate: claimed ${outcome} but ${gate.detail} — recording ${decision.outcome}\n`)
    } else if (gate && gate.checked) {
      process.stdout.write('record gate: objective checks green — pass confirmed\n')
    } else if (outcome === 'pass' && !skipGate) {
      process.stdout.write(`record gate: skipped (${gate ? gate.detail : 'read-only pipeline'})\n`)
    }
    const finalSummary = decision.note
      ? (summary ? `${decision.note} | claimed: ${summary}` : decision.note)
      : summary

    const result = recordOutcome(root, file, decision.outcome, finalSummary)
    process.stdout.write(`recorded ${decision.outcome}: moved to ${result.moved}\n`)
    // Harvest the runtime's cost/quality telemetry for any finished run into the ledger. A
    // hiccup here must never block the record itself — the outcome is already saved.
    try {
      const metrics = collectMetrics(root)
      if (metrics.added > 0) {
        process.stdout.write(`metrics: +${metrics.added} run(s) -> memory/run-metrics.jsonl\n`)
      }
    } catch (error) {
      process.stderr.write(`metrics harvest skipped: ${error.message}\n`)
    }
    return
  }

  const plan = planDispatch(root)

  if (!plan.registryOk) {
    for (const error of plan.registryErrors) {
      process.stderr.write(`FAIL  registry: ${error}\n`)
    }
    process.stderr.write('dispatch: refusing to route — the pipeline registry is broken\n')
    process.exitCode = 1
    return
  }

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    return
  }

  if (plan.items.length === 0) {
    process.stdout.write('dispatch: inbox is empty — nothing to route\n')
    return
  }

  process.stdout.write('dispatch plan (priority order):\n')
  for (const item of plan.routable) {
    const runner = item.automated ? item.workflow : `${item.workflow} (no workflow.js — run stages by hand)`
    process.stdout.write(`  [${item.priority}] ${item.file}  ->  ${item.pipeline}  (${runner})\n`)
  }
  for (const item of plan.invalid) {
    process.stdout.write(`  INVALID  ${item.file}  ->  ${item.reason}\n`)
  }
  process.stdout.write(`\n${plan.routable.length} routable, ${plan.invalid.length} invalid\n`)
  if (plan.invalid.length > 0) {
    process.stdout.write('invalid items are returned for correction, never guessed.\n')
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  runCli()
}
