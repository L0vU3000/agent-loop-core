// Delegation contract (pipelines/DELEGATION.md) — driven against the REAL workflow.js bodies.
//
// A workflow script is plain JS executed by the harness with agent/log/phase/pipeline injected, so
// the trick check-eval-scoring uses works here: build an AsyncFunction from the file and feed it a
// scripted lead. That makes the load-bearing properties testable for real rather than grepped for —
// a lead that proposes 50 sub-tasks must not get 50 workers.
//
// Every delegating pipeline runs the same four checks (cap / desk check / bounded rework / solo
// path), so adding one to TEAMS is how a newly delegating pipeline earns its coverage. The
// disjoint-files rule is extra and applies only to WRITING teams, where concurrent workers share
// one worktree.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const LOCKED = 'a'.repeat(64)

// Union of every pipeline's VERDICT booleans — a superset is harmless (each workflow reads only
// its own fields) and keeps one passing verdict for all three teams.
const PASSING_VERDICT = {
  verdict: 'pass', score: 100, passThreshold: 85, criticalFailures: 0,
  rubricValid: true, rubricSha256: LOCKED,
  acceptancePasses: true, suiteGreen: true, tscErrors: 0, noNewEslintWarnings: true,
  sectionsComplete: true, sourcesResolve: true, claimsSupported: true, noUnsupportedClaims: true,
  questionAnswered: true, uncertaintyStated: true,
  findingsVerified: true, noFalsePositives: true, evidenceCited: true, severityJustified: true,
  scopeCovered: true, ticketDrafted: true, droppedFindings: 0,
  evidence: 'delegation regression harness', reason: 'all checks passed',
}

const TEAMS = [
  {
    name: 'feature',
    writes: true,                       // concurrent workers share one worktree
    splitKey: 'tasks',
    frame: { specified: true, runId: 'delegation-regression', testPath: 'x.test.ts', criteria: 'c' },
    subtask: (n) => ({ title: `sub-task ${n}`, scope: `file-${n}.ts`, files: [`file-${n}.ts`] }),
    assembles: null,                    // the workers' writes ARE the product
  },
  {
    name: 'research',
    writes: false,
    splitKey: 'questions',
    frame: { accepted: true, runId: 'delegation-regression', questionKind: 'world', question: 'q' },
    subtask: (n) => ({ question: `sub-question ${n}`, sources: 'docs' }),
    assembles: 'synthesize#',           // notes are not the deliverable; the lead writes the report
  },
  {
    name: 'code-review',
    writes: false,
    splitKey: 'lenses',
    frame: { accepted: true, runId: 'delegation-regression', targetType: 'bug', reviewTarget: 'HEAD~1..HEAD' },
    subtask: (n) => ({ lens: `lens ${n}`, scope: `area ${n}` }),
    assembles: 'merge#',                // per-lens files are not the deliverable; the lead merges
  },
]

// The harness's own pipeline(): each item through every stage. Deliberately simple — these tests
// are about how many agents a workflow asks for, not about scheduling.
async function pipelineImpl(items, ...stages) {
  const out = []
  for (const [index, item] of items.entries()) {
    let value = item
    for (const stage of stages) value = await stage(value, item, index)
    out.push(value)
  }
  return out
}

async function runTeam(team, { split, deskVerdicts = {} } = {}) {
  const source = await readFile(new URL(`../pipelines/${team.name}/workflow.js`, import.meta.url), 'utf8')
  const labels = []
  const logs = []
  const prompts = []
  const deskCalls = {}

  async function agent(prompt, options) {
    const { label } = options
    labels.push(label)
    prompts.push({ label, prompt })

    if (label === 'explore') return team.frame
    if (label.startsWith('plan#')) return { rubricReady: true, passThreshold: 85, rubricSha256: LOCKED }
    if (label.startsWith('split#')) return { [team.splitKey]: split, reason: 'scripted split' }
    if (label.startsWith('desk#')) {
      // desk#<iteration>.<slot>[r<rework>] — key on the slot so one worker can be rejected alone.
      const slot = label.slice('desk#'.length).split('.')[1].replace(/r\d+$/, '')
      deskCalls[slot] = (deskCalls[slot] || 0) + 1
      const scripted = deskVerdicts[slot]
      if (Array.isArray(scripted)) {
        const accepted = scripted[Math.min(deskCalls[slot] - 1, scripted.length - 1)]
        return { accepted, reason: accepted ? '' : 'scripted rejection' }
      }
      return { accepted: true }
    }
    if (label.startsWith('eval#')) return PASSING_VERDICT
    // workers, rework, solo execute, and the lead's assembly stage return nothing structured.
    if (/^(worker#|rework#|execute#|synthesize#|merge#)/.test(label)) return {}
    throw new Error(`${team.name}: unexpected agent label: ${label}`)
  }

  const run = new AsyncFunction('args', 'phase', 'agent', 'log', 'pipeline', source.replace('export const meta', 'const meta'))
  await run('', () => {}, agent, (message) => logs.push(message), pipelineImpl)
  return { labels, logs, prompts }
}

const count = (labels, prefix) => labels.filter((label) => label.startsWith(prefix)).length
const split = (team, n) => Array.from({ length: n }, (_, index) => team.subtask(index + 1))

for (const team of TEAMS) {
  test(`${team.name}: the worker cap is enforced in code, not requested in the prompt`, async () => {
    // The documented failure mode: a plausible plan proposes far more workers than the job needs.
    const { labels, logs } = await runTeam(team, { split: split(team, 50) })

    assert.equal(count(labels, 'worker#'), 4, `a 50-way split must still run at most 4 workers, ran ${count(labels, 'worker#')}`)
    assert.ok(
      logs.some((line) => /proposed 50 .*; capped to 4/.test(line)),
      'the truncation must be reported, not silent — a silent cap reads as "the plan was followed"',
    )
  })

  test(`${team.name}: every delegated sub-task is desk-checked, and no worker may delegate`, async () => {
    const { labels, prompts } = await runTeam(team, { split: split(team, 3) })

    assert.equal(count(labels, 'worker#'), 3)
    assert.equal(count(labels, 'desk#'), 3, 'an unreviewed sub-task must never be accepted')

    const workerPrompt = prompts.find((entry) => entry.label.startsWith('worker#'))
    const deskPrompt = prompts.find((entry) => entry.label.startsWith('desk#'))
    assert.match(deskPrompt.prompt, /reviewing, not/, 'the desk check must review, not do the work over')
    assert.match(workerPrompt.prompt, /Do NOT delegate/, 'a worker must be forbidden from spawning its own team')

    if (team.assembles) {
      assert.equal(count(labels, team.assembles), 1, `${team.name} must assemble one deliverable from its workers' output`)
    }
  })

  test(`${team.name}: a rejected sub-task gets exactly one rework, then is reported up`, async () => {
    // Slot 2 fails its desk check twice; the loop must stop, not grind.
    const { labels, logs, prompts } = await runTeam(team, { split: split(team, 2), deskVerdicts: { 2: [false, false] } })

    assert.equal(count(labels, 'rework#'), 1, `bounded rework: expected 1 retry, got ${count(labels, 'rework#')}`)
    assert.equal(labels.filter((label) => /^desk#\d+\.2/.test(label)).length, 2)
    assert.ok(logs.some((line) => /1\/2 .*accepted at desk check/.test(line)), 'the lead must report the real accept count')

    // The lead must tell Eval the truth about what did not land — hiding it only delays the verdict.
    const evalPrompt = prompts.find((entry) => entry.label.startsWith('eval#'))
    assert.match(evalPrompt.prompt, /NOT accepted at desk check/)
    assert.match(evalPrompt.prompt, /desk check is not your verdict/)
  })

  test(`${team.name}: one sub-task takes the solo path — no delegation tax on simple work`, async () => {
    for (const n of [1, 0]) {
      const { labels, logs } = await runTeam(team, { split: split(team, n) })
      assert.equal(count(labels, 'worker#'), 0)
      assert.equal(count(labels, 'desk#'), 0)
      assert.equal(count(labels, 'execute#'), 1, 'the solo path must still run the plain execute stage')
      if (team.assembles) assert.equal(count(labels, team.assembles), 0, 'nothing to assemble when nobody was delegated to')
      assert.ok(logs.some((line) => /solo path/.test(line)))
    }
  })
}

// --- Writing teams only ----------------------------------------------------------------------
// Workers run concurrently in ONE shared worktree, so for a team that writes code an overlapping
// split is not merely slow — it is corrupt. Read-only teams have nothing to clobber, which is
// exactly why they were the safer place to adopt delegation first.
for (const team of TEAMS.filter((candidate) => candidate.writes)) {
  test(`${team.name}: a split whose workers would write the same file collapses to solo`, async () => {
    const overlapping = [
      { title: 'a', scope: 'auth', files: ['lib/auth.ts', 'lib/session.ts'] },
      { title: 'b', scope: 'session', files: ['lib/session.ts'] },
    ]
    const { labels, logs } = await runTeam(team, { split: overlapping })

    assert.equal(count(labels, 'worker#'), 0, 'no worker may run on an overlapping split')
    assert.equal(count(labels, 'execute#'), 1, 'it must fall back to solo, not skip the build')
    assert.ok(logs.some((line) => /split rejected — sub-tasks overlap/.test(line)), 'the rejection must be visible')
  })

  test(`${team.name}: a split that declares no files is unsafe, not trivially disjoint`, async () => {
    // The empty set overlaps with nothing, so a naive check waves this straight through — and a
    // worker with no declared scope is exactly the one that wanders into another's files.
    const undeclared = [
      { title: 'a', scope: 'auth', files: [] },
      { title: 'b', scope: 'session', files: ['lib/session.ts'] },
    ]
    const { labels } = await runTeam(team, { split: undeclared })

    assert.equal(count(labels, 'worker#'), 0)
    assert.equal(count(labels, 'execute#'), 1)
  })
}
