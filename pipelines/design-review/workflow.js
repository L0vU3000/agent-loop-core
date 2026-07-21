// design-review — automated pipeline runtime (built-in Workflow, no external deps).
// Review category: inspect one existing product surface (a route/screen the ticket names) with a
// designer's eye and produce verified, evidence-backed findings — visual inconsistency, spacing
// and hierarchy problems, accessibility gaps, and AI-slop patterns — looped
// explore → plan → execute → eval until the review scores at or above the locked threshold with no
// critical failures. Read-only on the product — the only writes are the findings report, its
// screenshots, and drafted `approved: false` fix tickets under runs/<run-id>/. No worktree, no
// database branch, no lint. Driving the browser is observe-only (navigate + screenshot, never
// mutate). maker (execute) != verifier (eval); eval on a different model. The verifier
// adversarially re-verifies every reported finding ON THE LIVE SURFACE and DROPS any it cannot
// reproduce. One runId is minted once and threaded through every stage (memory/errors.md).
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'design-review',
  description: 'Review one product surface (route/screen) and hand the owner verified, evidence-backed design findings (no fixes)',
  phases: [{ title: 'Frame' }, { title: 'Review loop' }],
}

const P = 'agent-loop/pipelines/design-review'
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code). Pass
// `--provider=gpt` to route every stage to codex. READ=explore/plan, MAKE=execute, VERIFY=eval
// (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TICKET = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: design-review)'
const MAX = 3

const FRAME = { type: 'object', required: ['accepted', 'runId'],
  properties: {
    accepted: { type: 'boolean' },
    runId: { type: 'string' },
    targetType: { type: 'string' },   // the building type a confirmed high-severity finding resolves to
    reviewTarget: { type: 'string' }, // the surface/route under review
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
    findingsVerified: { type: 'boolean' },   // every reported finding independently reproduced on the re-rendered surface
    noFalsePositives: { type: 'boolean' },   // findings not observable on the surface were dropped (anti-hallucination)
    evidenceCited: { type: 'boolean' },      // every surviving finding resolves to the surface + a specific element with screenshot/accessibility proof
    severityJustified: { type: 'boolean' },  // each severity matches the planned severity definitions
    scopeCovered: { type: 'boolean' },       // declared surface/states/viewports match the ticket's target
    ticketDrafted: { type: 'boolean' },      // valid approved:false fix ticket for each confirmed high-severity finding
    droppedFindings: { type: 'number' },     // how many false positives the verifier removed
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Frame')
const frame = await agent(
  `You are the EXPLORE stage of the design-review pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\` to orient before reading code. Apply the scope gate: accept only a request
   to REVIEW an existing surface that names a real route/screen which renders with real content.
   Confirm the surface renders (auth/demo mode + seed state), then map it (route, component tree,
   the states and viewports worth observing) and the design constraints it must honor (Tailwind +
   shadcn/ui system, the fully-wired UI standard, the words-to-avoid AI-slop list). Return accepted,
   runId, the downstream building targetType a confirmed high-severity finding resolves to, and the
   reviewTarget. If the request is a build/restyle job, a correctness review (→ code-review), a
   security audit (→ security-review), a structure audit (→ architecture-review), or a surface with
   nothing to observe, set accepted=false and explain in note — do not invent a surface to review.`,
  { label: 'explore', schema: FRAME, ...TIER.read })

if (!frame.accepted) {
  log(`STOP: not a design-review task — ${frame.note || 'see explore notes'}. Routed elsewhere or returned.`)
  return { reviewed: false, note: frame.note }
}

const RUN = frame.runId
log(`run ${RUN} — framed. surface: ${frame.reviewTarget || 'tbd'} · downstream: ${frame.targetType || 'tbd'}`)

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
     Decide the review scope (surface, states, viewports) and the severity definitions for this
     surface, name the downstream building pipeline a confirmed high-severity finding resolves to,
     and author the task-specific 100-point Eval rubric required by plan.md (findings-verified,
     no-false-positives, evidence-cited, severity-justified, and scope-covered are critical). Hash
     the exact Eval-rubric section with SHA-256 and return rubricReady, passThreshold, and
     rubricSha256. On retries keep that section byte-for-byte unchanged unless a human approved a
     rubric change.`,
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

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\`. Drive ONLY the in-scope surface/states/viewports with the design-review
     gstack skill in observe-only mode (navigate + screenshot, never submit or mutate), then write
     the findings report (findings.md) — each finding severity · location (surface + specific
     element) · cited evidence (screenshot / accessibility-check result) · why it matters,
     most-severe first — and the drafted fix tickets (proposed-tickets.md, \`approved: false\`) for
     each confirmed high-severity finding. Capture screenshots under runs/${RUN}/. Ground every
     finding in a re-observable element on the surface; a false positive is worse than a miss —
     report zero findings if the surface is clean. Do NOT edit product source, styles, or the live
     orchestrator inbox. If the plan's scope is wrong, stop and report — don't invent findings.`,
    { label: `execute#${i}`, phase: 'Review loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Adversarially re-verify EVERY reported
     finding ON THE LIVE SURFACE: re-render the route at the stated viewport/state with the
     design-review gstack skill (observe-only), locate the cited element, and re-observe the claimed
     visual or accessibility defect. DROP any finding you cannot reproduce on the surface or whose
     cited element does not exhibit the problem (a surviving false positive is a critical failure),
     then confirm evidence resolves to a re-observable element, severity matches the definitions,
     and the declared scope matches the ticket's target. Apply the locked rubric at SHA-256
     ${lockedRubricSha256} and threshold ${lockedPassThreshold}/100. Return score, passThreshold,
     criticalFailures, rubricValid, rubricSha256, the section booleans, and droppedFindings.`,
    { label: `eval#${i}`, phase: 'Review loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · verified ${v.findingsVerified ? 'yes' : 'NO'} · no-false-positives ${v.noFalsePositives ? 'yes' : 'NO'} · dropped ${v.droppedFindings ?? '?'} · severity ${v.severityJustified ? 'ok' : 'NO'} · scope ${v.scopeCovered ? 'yes' : 'NO'}`)

  if (v.rubricSha256 !== lockedRubricSha256 || v.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval observed a changed rubric fingerprint or threshold; human approval is required.')
    return { reviewed: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  if (v.verdict === 'pass' && v.rubricValid && v.rubricSha256 === lockedRubricSha256 && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.findingsVerified && v.noFalsePositives && v.evidenceCited && v.severityJustified && v.scopeCovered && v.ticketDrafted) {
    // Review gate: findings are advisory. They are NOT auto-fixed and NOT auto-dispatched. The owner
    // reviews the design findings and decides which to act on; an accepted high-severity finding's
    // drafted fix ticket is then promoted from runs/ to the inbox with approved: true by the owner.
    log(`FINDINGS READY: review ${P}/runs/${RUN}/findings.md and proposed-tickets.md, then promote any fix ticket you accept to the inbox to build it. The owner decides what to fix.`)
    return { reviewed: true, awaitingOwnerTriage: true, iterations: i, targetType: frame.targetType, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'} · verified ${v.findingsVerified ? 'yes' : 'no'} · no-false-positives ${v.noFalsePositives ? 'yes' : 'no'} · scope ${v.scopeCovered ? 'yes' : 'no'}`
}

log(`STOP: no passing review within ${MAX} iterations — handing back to a human.`)
return { reviewed: false, iterations: i, runId: RUN }
