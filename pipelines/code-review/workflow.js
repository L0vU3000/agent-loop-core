// code-review — automated pipeline runtime (built-in Workflow, no external deps).
// Review category: inspect one existing change (a branch, diff, or PR) and produce verified,
// evidence-backed findings — correctness bugs plus reuse/simplification/efficiency cleanups —
// looped explore → plan → execute → eval until the review scores at or above the locked threshold
// with no critical failures. Read-only on the product — the only writes are the findings report +
// drafted `approved: false` fix tickets under runs/<run-id>/. No worktree, no database branch, no
// lint. maker (execute) != verifier (eval); eval on a different model. The verifier adversarially
// re-verifies every reported finding and DROPS any it cannot reproduce. One runId is minted once
// and threaded through every stage (memory/errors.md).
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'code-review',
  description: 'Review one branch/diff/PR and hand the owner verified, evidence-backed findings (no fixes)',
  phases: [{ title: 'Frame' }, { title: 'Review loop' }],
}

const P = 'agent-loop/pipelines/code-review'
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code). Pass
// `--provider=gpt` to route every stage to codex. READ=explore/plan, MAKE=execute, VERIFY=eval
// (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TICKET = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: code-review)'
const MAX = 3

// --- Delegation (see ../DELEGATION.md) -------------------------------------------------------
// Execute runs as a LEAD: split the review into independent LENSES (correctness, security,
// performance, ...) or areas, hand each to a WORKER, desk-check what comes back, then merge one
// findings report. Read-only, so there is nothing for concurrent workers to clobber; the caps are
// the same, because over-spawning is how this pattern runs up a bill.
const MAX_WORKERS = 4
const MAX_REWORK = 1

const SPLIT = { type: 'object', required: ['lenses'],
  properties: {
    lenses: { type: 'array', items: { type: 'object', required: ['lens', 'scope'],
      properties: { lens: { type: 'string' }, scope: { type: 'string' } } } },
    reason: { type: 'string' },
  } }

const DESK = { type: 'object', required: ['accepted'],
  properties: {
    accepted: { type: 'boolean' },
    reason: { type: 'string' },
  } }

const FRAME = { type: 'object', required: ['accepted', 'runId'],
  properties: {
    accepted: { type: 'boolean' },
    runId: { type: 'string' },
    targetType: { type: 'string' },   // the building type a confirmed high-severity finding resolves to
    reviewTarget: { type: 'string' }, // the branch/diff/PR under review
    note: { type: 'string' },
  } }

const PLAN = { type: 'object', required: ['rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  } }

const VERDICT = { type: 'object',
  required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256',
    'findingsVerified', 'noFalsePositives', 'evidenceCited', 'severityJustified', 'scopeCovered',
    'ticketDrafted'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    findingsVerified: { type: 'boolean' },   // every reported finding independently reproduced / re-confirmed
    noFalsePositives: { type: 'boolean' },   // unreproducible or misquoted findings were dropped (anti-hallucination)
    evidenceCited: { type: 'boolean' },      // every surviving finding resolves to a real file:line with quoted proof
    severityJustified: { type: 'boolean' },  // each severity matches the planned severity definitions
    scopeCovered: { type: 'boolean' },       // declared review scope matches the target's actual diff
    ticketDrafted: { type: 'boolean' },      // valid approved:false fix ticket for each confirmed high-severity finding
    droppedFindings: { type: 'number' },     // how many false positives the verifier removed
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Frame')
const frame = await agent(
  `You are the EXPLORE stage of the code-review pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\` to orient before reading code. Apply the scope gate: accept only a request
   to REVIEW an existing change that names a real branch/diff/PR with an actual diff. Resolve the
   base/head and record the exact files and hunks in scope, then map the change (services, actions,
   components, schema, callers) and the constraints in the project conventions doc (see STACK.md) it must respect. Return accepted,
   runId, the downstream building targetType a confirmed high-severity finding resolves to, and the
   reviewTarget. If the request is a build/fix job, a security audit (→ security-review), a structure
   audit (→ architecture-review), a design critique (→ design-review), or a target with no diff, set
   accepted=false and explain in note — do not invent a change to review.`,
  { label: 'explore', schema: FRAME, ...TIER.read })

if (!frame.accepted) {
  log(`STOP: not a code-review task — ${frame.note || 'see explore notes'}. Routed elsewhere or returned.`)
  return { reviewed: false, note: frame.note }
}

const RUN = frame.runId
log(`run ${RUN} — framed. target: ${frame.reviewTarget || 'tbd'} · downstream: ${frame.targetType || 'tbd'}`)

phase('Review loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Review target: ${frame.reviewTarget}. Downstream target: ${frame.targetType}.
     ${last ? `Previous attempt failed: ${last}. Adjust.` : ''}
     Decide the review scope (exact files/hunks) and the severity definitions for this change, name
     the downstream building pipeline a confirmed high-severity finding resolves to, and author the
     task-specific 100-point Eval rubric required by plan.md (findings-verified, no-false-positives,
     evidence-cited, severity-justified, and scope-covered are critical). Hash the exact Eval-rubric
     section with SHA-256 and return rubricReady, passThreshold, and rubricSha256. On retries keep
     that section byte-for-byte unchanged unless a human approved a rubric change.`,
    { label: `plan#${i}`, phase: 'Review loop', schema: PLAN, ...TIER.read })

  if (!plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${plan.reason || 'see plan.md'}`)
    return { reviewed: false, invalidRubric: true, iterations: i, runId: RUN }
  }

  if (lockedRubricSha256 === null) {
    lockedRubricSha256 = plan.rubricSha256
    lockedPassThreshold = plan.passThreshold
  } else if (plan.rubricSha256 !== lockedRubricSha256 || plan.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval rubric or threshold changed after scoring began; human approval is required.')
    return { reviewed: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  // EXECUTE — the lead decides whether this review is worth more than one pair of eyes.
  const split = await agent(
    `You are the LEAD of the execute stage. Follow ${P}/execute.md and ../DELEGATION.md.
     Read \`${P}/runs/${RUN}/plan.md\` and split the review into INDEPENDENT lenses or areas —
     independent means each can be reviewed without another's findings. Distinct lenses
     (correctness, security, performance, data integrity) beat N reviewers repeating one pass:
     redundancy finds the same bug four times, diversity finds four bugs. Return at most
     ${MAX_WORKERS}. Return ZERO OR ONE when the change is small or one lens covers it — the solo
     path is the default and is not a failure. Do not split a two-file diff four ways.`,
    { label: `split#${i}`, phase: 'Review loop', schema: SPLIT, ...TIER.read })

  // The cap is applied HERE, in code — whatever the lead proposed, at most MAX_WORKERS run.
  const lenses = (split.lenses || []).slice(0, MAX_WORKERS)
  if ((split.lenses || []).length > MAX_WORKERS) {
    log(`lead proposed ${split.lenses.length} lenses; capped to ${MAX_WORKERS}`)
  }

  let unreviewed = []
  if (lenses.length <= 1) {
    log(`iter ${i}: solo path — ${split.reason || 'one reviewer covers this change'}`)
    await agent(
      `You are the EXECUTE stage (MAKER, working solo). Follow ${P}/execute.md. Write only into
       \`${P}/runs/${RUN}/\`. Review only the in-scope files/hunks with the /code-review and /review
       skills, then write the findings report (findings.md) — each finding severity · location
       (file:line) · cited evidence · why it matters, most-severe first — and the drafted fix tickets
       (proposed-tickets.md, \`approved: false\`) for each confirmed high-severity finding. Ground
       every finding in real code with a reproducible trigger; a false positive is worse than a miss —
       report zero findings if the change is clean. Do NOT edit product source, schema, or the live
       orchestrator inbox. If the plan's scope is wrong, stop and report — don't invent findings.`,
      { label: `execute#${i}`, phase: 'Review loop', ...TIER.make })
  } else {
    log(`iter ${i}: delegating ${lenses.length} lens(es)`)
    const reviewed = await pipeline(
      lenses,
      (item, _original, n) => agent(
        `You are a WORKER on the review team. Follow ${P}/execute.md. Review the in-scope change
         through EXACTLY this one lens and nothing else: ${item.lens} — ${item.scope}
         Write your findings to \`${P}/runs/${RUN}/findings-${n + 1}.md\` — severity · location
         (file:line) · cited evidence · why it matters. Another worker owns the other lenses; do not
         duplicate their ground. Ground every finding in real code with a reproducible trigger; a
         false positive is worse than a miss — report zero findings if this lens is clean. Do NOT
         edit product source, schema, or the live orchestrator inbox. Do NOT delegate any part of
         this to another agent — you are the one doing the work.`,
        { label: `worker#${i}.${n + 1}`, phase: 'Review loop', ...TIER.make }),

      async (_found, item, n) => {
        // DESK CHECK — a different agent than the worker. Kills the obvious false positives before
        // Eval's adversarial re-verification, which is the expensive pass.
        let note = ''
        for (let attempt = 0; attempt <= MAX_REWORK; attempt++) {
          const desk = await agent(
            `You are the LEAD desk-checking a worker's findings before they enter the report.
             Lens: ${item.lens} — ${item.scope}
             Read \`${P}/runs/${RUN}/findings-${n + 1}.md\`. For each finding, re-read the cited
             file:line and confirm the code actually says what the finding claims. Reject the set if
             any finding misquotes the code, cannot be triggered, or sits outside the declared scope
             — name which one and why. An empty findings list is a valid, acceptable result. You are
             reviewing, not reviewing the code yourself — do not add findings.`,
            { label: `desk#${i}.${n + 1}${attempt ? `r${attempt}` : ''}`, phase: 'Review loop', schema: DESK, ...TIER.verify })
          if (desk.accepted) return { item, accepted: true }
          note = desk.reason || 'rejected without a reason'
          if (attempt === MAX_REWORK) break
          await agent(
            `You are the WORKER. Your findings were rejected at desk check: ${note}
             Fix exactly that for the ${item.lens} lens: drop what you cannot reproduce, correct any
             misquoted evidence. Do not widen the lens, do not delegate, do not pad the list.`,
            { label: `rework#${i}.${n + 1}`, phase: 'Review loop', ...TIER.make })
        }
        return { item, accepted: false, reason: note }
      })

    unreviewed = reviewed.filter(Boolean).filter((r) => !r.accepted)
    log(`iter ${i}: ${lenses.length - unreviewed.length}/${lenses.length} lens(es) accepted at desk check`)

    // MERGE — the team's product is one findings report, not N per-lens files.
    await agent(
      `You are the LEAD, merging the team's accepted findings into one report. Follow
       ${P}/execute.md. Write only into \`${P}/runs/${RUN}/\`: findings.md (most-severe first,
       de-duplicated where two lenses found the same defect, each keeping its strongest cited
       evidence) and proposed-tickets.md (\`approved: false\`) for each confirmed high-severity
       finding. Carry findings through from \`findings-*.md\` — do not invent any that no worker
       reported.
       ${unreviewed.length ? `These lenses did NOT pass desk check and must be declared as not covered in the report's scope section: ${unreviewed.map((r) => r.item.lens).join('; ')}.` : ''}
       Do NOT edit product source, schema, or the live orchestrator inbox.`,
      { label: `merge#${i}`, phase: 'Review loop', ...TIER.make })
  }

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     ${unreviewed.length ? `The lead reports ${unreviewed.length} lens(es) NOT accepted at desk check: ${unreviewed.map((r) => r.item.lens).join('; ')}. A desk check is not your verdict — re-verify everything reported, and treat an uncovered lens presented as covered scope as a critical failure.` : ''}
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Adversarially re-verify EVERY reported
     finding: independently reproduce it or re-read the cited file:line with \`graphify\` and file
     reads to confirm the code actually says what the finding claims. DROP any finding you cannot
     reproduce or that misquotes the code (a surviving false positive is a critical failure), then
     confirm evidence resolves, severity matches the definitions, and the declared scope matches the
     target's actual diff. Apply the locked rubric at SHA-256 ${lockedRubricSha256} and threshold
     ${lockedPassThreshold}/100. Return score, passThreshold, criticalFailures, rubricValid,
     rubricSha256, the section booleans, and droppedFindings.`,
    { label: `eval#${i}`, phase: 'Review loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · verified ${v.findingsVerified ? 'yes' : 'NO'} · no-false-positives ${v.noFalsePositives ? 'yes' : 'NO'} · dropped ${v.droppedFindings ?? '?'} · severity ${v.severityJustified ? 'ok' : 'NO'} · scope ${v.scopeCovered ? 'yes' : 'NO'}`)

  if (v.rubricSha256 !== lockedRubricSha256 || v.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval observed a changed rubric fingerprint or threshold; human approval is required.')
    return { reviewed: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  if (v.verdict === 'pass' && v.rubricValid && v.rubricSha256 === lockedRubricSha256 && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.findingsVerified && v.noFalsePositives && v.evidenceCited && v.severityJustified && v.scopeCovered && v.ticketDrafted) {
    // Review gate: findings are advisory. They are NOT auto-fixed and NOT auto-dispatched. The owner
    // reviews the findings and decides which to act on; an accepted high-severity finding's drafted
    // fix ticket is then promoted from runs/ to the inbox with approved: true by the owner.
    log(`FINDINGS READY: review ${P}/runs/${RUN}/findings.md and proposed-tickets.md, then promote any fix ticket you accept to the inbox to build it. The owner decides what to fix.`)
    return { reviewed: true, awaitingOwnerTriage: true, iterations: i, targetType: frame.targetType, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'} · verified ${v.findingsVerified ? 'yes' : 'no'} · no-false-positives ${v.noFalsePositives ? 'yes' : 'no'} · scope ${v.scopeCovered ? 'yes' : 'no'}`
}

log(`STOP: no passing review within ${MAX} iterations — handing back to a human.`)
return { reviewed: false, iterations: i, runId: RUN }
