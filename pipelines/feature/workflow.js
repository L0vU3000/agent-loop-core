// feature — automated pipeline runtime (built-in Workflow, no external deps).
// Pattern: specify with failing acceptance tests (explore) → plan → execute → eval, looped
// until the acceptance tests go green with no regressions. maker (execute) != verifier
// (eval); eval on a different model. A single runId is minted once and threaded through
// every stage (lesson from memory/errors.md — do not let stages invent their own).
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'feature',
  description: 'Turn a feature ticket into failing acceptance tests, build the smallest change that satisfies them, verify red-to-green',
  phases: [{ title: 'Specify' }, { title: 'Build loop' }],
}

const P = 'agent-loop/pipelines/feature'
const LINT = 'npx eslint app lib components'
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code, so the
// session is Claude). Pass `--provider=gpt` in args to route every stage to codex
// (gpt-5.1-codex-max), effort as the cheap→deep gradient. READ=explore/plan, MAKE=execute,
// VERIFY=eval (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TICKET = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: feature)'
const MAX = 6

// --- Delegation (see ../DELEGATION.md) -------------------------------------------------------
// Execute runs as a LEAD: split the approved plan, hand each independent sub-task to a WORKER,
// DESK-CHECK what comes back, assemble, report up. Eval is untouched — the team still hands the
// router exactly one verified result.
//
// Both numbers are enforced in code below, never merely asked for in the prompt. Over-spawning is
// the documented way this pattern fails (a plausible plan proposes 40 workers where 3 would do),
// and a cap a model is politely asked to respect is not a cap.
const MAX_WORKERS = 4
const MAX_REWORK = 1

const SPLIT = { type: 'object', required: ['tasks'],
  properties: {
    tasks: { type: 'array', items: { type: 'object', required: ['title', 'scope', 'files'],
      properties: {
        title: { type: 'string' },
        scope: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } }, // the exact paths this worker may write
      } } },
    reason: { type: 'string' },
  } }

// Workers run CONCURRENTLY in ONE shared worktree — this is a writing pipeline, so two workers
// touching the same file clobber each other, and a prompt asking them to stay in scope is not a
// lock. A split is therefore only safe when the declared file sets are disjoint, and that is
// checked here in code for the same reason the worker cap is: the lead's word is not a guarantee.
// Overlap, or a task that declares no files at all, collapses the whole split to the solo path —
// slower than a good split, but it cannot produce a half-clobbered build.
function fileDisjoint(tasks) {
  const claimed = new Set()
  for (const task of tasks) {
    const files = (task.files || []).map((file) => file.trim()).filter(Boolean)
    if (files.length === 0) return false
    for (const file of files) {
      if (claimed.has(file)) return false
      claimed.add(file)
    }
  }
  return true
}

const DESK = { type: 'object', required: ['accepted'],
  properties: {
    accepted: { type: 'boolean' },
    reason: { type: 'string' },
  } }

const SPEC = { type: 'object', required: ['specified', 'runId'],
  properties: {
    specified: { type: 'boolean' },
    runId: { type: 'string' },
    testPath: { type: 'string' },
    criteria: { type: 'string' },
    note: { type: 'string' },
  } }

const PLAN = { type: 'object', required: ['rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  } }

const VERDICT = { type: 'object', required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256', 'acceptancePasses', 'suiteGreen', 'tscErrors', 'noNewEslintWarnings'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    acceptancePasses: { type: 'boolean' },
    suiteGreen: { type: 'boolean' },
    tscErrors: { type: 'number' },
    noNewEslintWarnings: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Specify')
const spec = await agent(
  `You are the EXPLORE stage of the feature pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\` to orient before reading code. Extract the ticket's acceptance
   criteria and write FAILING acceptance test(s) that encode them (confirm they are red for
   the right reason — the feature is missing). Return specified, runId, testPath, and a
   one-line criteria summary. If the criteria are ambiguous, set specified=false and explain
   in note — do not invent product behavior.`,
  { label: 'explore', schema: SPEC, ...TIER.read })

if (!spec.specified) {
  log(`STOP: could not specify — ${spec.note || 'see explore notes'}. Ticket goes back for clarification.`)
  return { specified: false, note: spec.note }
}

const RUN = spec.runId
log(`run ${RUN} — specified. acceptance tests: ${spec.testPath}`)

phase('Build loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Acceptance criteria: ${spec.criteria}. Failing tests: ${spec.testPath}.
     ${last ? `Previous attempt failed: ${last}. Adjust.` : ''}
     Plan the smallest build that makes the acceptance tests pass. Create the task-specific
     100-point Eval rubric required by plan.md. Hash the exact Eval-rubric section with SHA-256
     and return rubricReady, passThreshold, and rubricSha256. On retries, keep that section
     byte-for-byte unchanged unless a human approved a rubric change.`,
    { label: `plan#${i}`, phase: 'Build loop', schema: PLAN, ...TIER.read })

  if (!plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${plan.reason || 'see plan.md'}`)
    return { built: false, invalidRubric: true, iterations: i, runId: RUN }
  }

  if (lockedRubricSha256 === null) {
    lockedRubricSha256 = plan.rubricSha256
    lockedPassThreshold = plan.passThreshold
  } else if (plan.rubricSha256 !== lockedRubricSha256 || plan.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval rubric or threshold changed after scoring began; human approval is required.')
    return { built: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  // EXECUTE — the lead first decides whether this plan is even a team's worth of work.
  const split = await agent(
    `You are the LEAD of the execute stage. Follow ${P}/execute.md and ../DELEGATION.md.
     Read \`${P}/runs/${RUN}/plan.md\` and split it into INDEPENDENT sub-tasks — independent means
     they touch different files and neither needs the other's output. Return at most ${MAX_WORKERS}.
     For EACH sub-task, list in \`files\` the exact paths that worker will write. Those lists must
     not overlap: workers run at the same time in the same tree, so two of them on one file
     overwrite each other. If you cannot split the plan into file-disjoint pieces, return a single
     task (or none) and say why in \`reason\`.
     Return ZERO OR ONE task when the plan is one engineer's work or its steps must happen in
     order: the solo path is the default and is not a failure. Do not invent parallelism to look
     busy — a split that removes no wall-clock or context pressure is worse than no split.`,
    { label: `split#${i}`, phase: 'Build loop', schema: SPLIT, ...TIER.read })

  // The cap is applied HERE, in code. Whatever the lead proposed, at most MAX_WORKERS run.
  const tasks = (split.tasks || []).slice(0, MAX_WORKERS)
  if ((split.tasks || []).length > MAX_WORKERS) {
    log(`lead proposed ${split.tasks.length} sub-tasks; capped to ${MAX_WORKERS}`)
  }

  const safeToSplit = tasks.length > 1 && fileDisjoint(tasks)
  if (tasks.length > 1 && !safeToSplit) {
    log(`iter ${i}: split rejected — sub-tasks overlap on files (or declared none); falling back to solo`)
  }

  let incomplete = []
  if (!safeToSplit) {
    log(`iter ${i}: solo path — ${split.reason || 'plan is one engineer\'s work'}`)
    await agent(
      `You are the EXECUTE stage (MAKER, working solo). Follow ${P}/execute.md. Write only into
       \`${P}/runs/${RUN}/\`. Build exactly what the plan describes. Do NOT modify the
       acceptance tests to make them pass. If the plan is wrong, stop and report — don't
       improvise.`,
      { label: `execute#${i}`, phase: 'Build loop', ...TIER.make })
  } else {
    log(`iter ${i}: delegating ${tasks.length} sub-task(s)`)
    // pipeline(), not parallel(): each sub-task desk-checks the moment its worker finishes,
    // instead of every reviewer waiting on the slowest build.
    const reviewed = await pipeline(
      tasks,
      (task, _original, n) => agent(
        `You are a WORKER on the feature team. Follow ${P}/execute.md. Write only into
         \`${P}/runs/${RUN}/\`. Build EXACTLY this one sub-task and nothing else:
         ${task.title} — ${task.scope}
         Stay inside that scope; another worker owns the rest of the plan and you will collide with
         them if you widen. Do NOT modify the acceptance tests. Do NOT delegate any part of this to
         another agent — you are the one doing the work. If this sub-task cannot be built as
         described, stop and report why rather than improvising a different design.`,
        { label: `worker#${i}.${n + 1}`, phase: 'Build loop', ...TIER.make }),

      async (_built, task, n) => {
        // DESK CHECK — a different agent than the worker (TIER.verify vs TIER.make). Cheap early
        // filter, not a replacement for Eval.
        let note = ''
        for (let attempt = 0; attempt <= MAX_REWORK; attempt++) {
          const desk = await agent(
            `You are the LEAD desk-checking a worker's sub-task before accepting it into the build.
             Sub-task: ${task.title} — ${task.scope}
             Read what changed under \`${P}/runs/${RUN}/\` and in the working tree. Accept only if
             the sub-task is actually built as scoped, stays inside its scope, and did not modify
             the acceptance tests. Reject with a specific, actionable reason otherwise. You are
             reviewing, not building — do not fix it yourself.`,
            { label: `desk#${i}.${n + 1}${attempt ? `r${attempt}` : ''}`, phase: 'Build loop', schema: DESK, ...TIER.verify })
          if (desk.accepted) return { task, accepted: true }
          note = desk.reason || 'rejected without a reason'
          if (attempt === MAX_REWORK) break
          await agent(
            `You are the WORKER. Your sub-task was rejected at desk check: ${note}
             Fix exactly that, inside the same scope: ${task.title} — ${task.scope}. Do not widen,
             do not touch the acceptance tests, do not delegate.`,
            { label: `rework#${i}.${n + 1}`, phase: 'Build loop', ...TIER.make })
        }
        // Bounded: still rejected after its rework, so it is reported up as incomplete rather
        // than looped on. Eval will see the gap; hiding it would only delay the same verdict.
        return { task, accepted: false, reason: note }
      })

    incomplete = reviewed.filter(Boolean).filter((r) => !r.accepted)
    log(`iter ${i}: ${tasks.length - incomplete.length}/${tasks.length} sub-task(s) accepted at desk check`)
    if (incomplete.length > 0) {
      log(`iter ${i}: incomplete — ${incomplete.map((r) => `${r.task.title}: ${r.reason}`).join(' · ')}`)
    }
  }

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     ${incomplete.length ? `The lead reports ${incomplete.length} sub-task(s) NOT accepted at desk check: ${incomplete.map((r) => `${r.task.title} (${r.reason})`).join('; ')}. Verify the build on its merits regardless — a desk check is not your verdict.` : ''}
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Run the acceptance tests at
     ${spec.testPath} (must go green, unmodified), \`npx vitest run\` (whole suite green),
     \`npx tsc --noEmit\` (0 errors), and \`${LINT}\` (no new warnings). Return the verdict
     with cited evidence. Apply the locked rubric at SHA-256 ${lockedRubricSha256} and threshold
     ${lockedPassThreshold}/100. Return score, passThreshold, criticalFailures, rubricValid,
     rubricSha256, noNewEslintWarnings, and cited evidence.`,
    { label: `eval#${i}`, phase: 'Build loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · acceptance ${v.acceptancePasses ? 'green' : 'RED'} · suite ${v.suiteGreen ? 'green' : 'RED'} · tsc ${v.tscErrors} · eslint ${v.noNewEslintWarnings ? 'no-new-warnings' : 'REGRESSED'}`)

  if (v.rubricSha256 !== lockedRubricSha256 || v.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval observed a changed rubric fingerprint or threshold; human approval is required.')
    return { built: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  if (v.verdict === 'pass' && v.rubricValid && v.rubricSha256 === lockedRubricSha256 && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.acceptancePasses && v.suiteGreen && v.tscErrors === 0 && v.noNewEslintWarnings) {
    log(`DONE: feature built and guarded by ${spec.testPath}`)
    return { built: true, iterations: i, testPath: spec.testPath, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'} · lint ${v.noNewEslintWarnings ? 'unchanged' : 'regressed'} · evidence ${v.evidence || 'none cited'}`
}

log(`STOP: not built within ${MAX} iterations — handing back to a human.`)
return { built: false, iterations: i, runId: RUN }
