// architecture-review — automated pipeline runtime (built-in Workflow, no external deps).
// Review category: inspect the structure of an existing subsystem/module (or the whole repo) and
// produce verified, evidence-backed findings — layering violations, tight coupling, dependency
// cycles, drift from CLAUDE.md's architecture rules, and dead/parallel code — looped
// explore → plan → execute → eval until the review scores at or above the locked threshold with no
// critical failures. Read-only on the product — the only writes are the findings report + drafted
// `approved: false` refactor tickets under runs/<run-id>/. No worktree, no database branch, no
// lint. maker (execute) != verifier (eval); eval on a different model. The verifier adversarially
// re-verifies every reported finding and DROPS any it cannot substantiate. The engine is
// `graphify` (query/path/explain, GRAPH_REPORT.md) plus reading. One runId is minted once and
// threaded through every stage (memory/errors.md).
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'architecture-review',
  description: 'Review one subsystem/module (or the repo) for structural problems and hand the owner verified, evidence-backed findings (no fixes)',
  phases: [{ title: 'Frame' }, { title: 'Review loop' }],
}

const P = 'agent-loop/pipelines/architecture-review'
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code). Pass
// `--provider=gpt` to route every stage to codex. READ=explore/plan, MAKE=execute, VERIFY=eval
// (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TICKET = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: architecture-review)'
const MAX = 3

const FRAME = { type: 'object', required: ['accepted', 'runId'],
  properties: {
    accepted: { type: 'boolean' },
    runId: { type: 'string' },
    targetType: { type: 'string' },   // the building type a confirmed high-severity finding resolves to
    reviewTarget: { type: 'string' }, // the subsystem/module (or whole repo) under review
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
    findingsVerified: { type: 'boolean' },   // every reported structural finding independently re-verified
    noFalsePositives: { type: 'boolean' },   // findings the verifier could not substantiate were dropped (anti-hallucination)
    evidenceCited: { type: 'boolean' },      // every survivor resolves to a real file/module + the rule or dependency edge it violates
    severityJustified: { type: 'boolean' },  // each severity matches the planned severity definitions
    scopeCovered: { type: 'boolean' },       // the declared review scope matches the subsystem/module actually under review
    ticketDrafted: { type: 'boolean' },      // valid approved:false refactor ticket for each confirmed high-severity finding
    droppedFindings: { type: 'number' },     // how many unsubstantiated findings the verifier removed
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Frame')
const frame = await agent(
  `You are the EXPLORE stage of the architecture-review pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\`/\`path\`/\`explain\` and GRAPH_REPORT.md to orient before reading source.
   Apply the scope gate: accept only a request to REVIEW the STRUCTURE of an existing subsystem,
   module, or the whole repo that resolves against the codebase. Resolve exactly which files and
   modules the review covers, then map the region's dependency edges, the layering rules from
   CLAUDE.md it must respect, and any dead/parallel code (e.g. the archived Convex layer). Return
   accepted, runId, the downstream building targetType a confirmed high-severity finding resolves
   to, and the reviewTarget. If the request is a build/refactor job, a line-level correctness
   review (→ code-review), a security audit (→ security-review), a visual critique (→
   design-review), or names no resolvable subsystem, set accepted=false and explain in note — do
   not invent a structure to review.`,
  { label: 'explore', schema: FRAME, ...TIER.read })

if (!frame.accepted) {
  log(`STOP: not an architecture-review task — ${frame.note || 'see explore notes'}. Routed elsewhere or returned.`)
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
     Decide the review scope (exact files/modules) and the severity definitions for this structure,
     name the downstream building pipeline a confirmed high-severity finding resolves to, and author
     the task-specific 100-point Eval rubric required by plan.md (findings-verified, no-false-positives,
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

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\`. Review the STRUCTURE of only the in-scope files/modules with
     \`graphify\` (query/path/explain, GRAPH_REPORT.md) plus reading, then write the findings report
     (findings.md) — each finding severity · location (file:line or module) · cited evidence (the
     exact rule from CLAUDE.md or the dependency edge it violates) · why it matters, most-severe
     first — and the drafted refactor tickets (proposed-tickets.md, \`approved: false\`) for each
     confirmed high-severity finding. Ground every finding in a real file/module and a named rule
     or dependency edge; a false positive is worse than a miss — report zero findings if the
     structure is sound. Do NOT edit product source, schema, or the live orchestrator inbox. If the
     plan's scope is wrong, stop and report — don't invent findings.`,
    { label: `execute#${i}`, phase: 'Review loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Adversarially re-verify EVERY reported
     finding: independently substantiate it with \`graphify path\`/\`query\` and file reads —
     confirm the cited dependency edge actually exists and the cited CLAUDE.md rule actually applies
     to the cited code. DROP any finding you cannot substantiate or that misreads the structure (a
     surviving false positive is a critical failure), then confirm each survivor's evidence
     resolves, severity matches the definitions, and the declared scope matches the subsystem
     actually under review. Apply the locked rubric at SHA-256 ${lockedRubricSha256} and threshold
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
    // refactor ticket is then promoted from runs/ to the inbox with approved: true by the owner.
    log(`FINDINGS READY: review ${P}/runs/${RUN}/findings.md and proposed-tickets.md, then promote any refactor ticket you accept to the inbox to build it. The owner decides what to fix.`)
    return { reviewed: true, awaitingOwnerTriage: true, iterations: i, targetType: frame.targetType, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'} · verified ${v.findingsVerified ? 'yes' : 'no'} · no-false-positives ${v.noFalsePositives ? 'yes' : 'no'} · scope ${v.scopeCovered ? 'yes' : 'no'}`
}

log(`STOP: no passing review within ${MAX} iterations — handing back to a human.`)
return { reviewed: false, iterations: i, runId: RUN }
