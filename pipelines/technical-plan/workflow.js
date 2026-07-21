// technical-plan — automated pipeline runtime (built-in Workflow, no external deps).
// Planning category: turn one already-approved scope or spec into a precise, grounded technical
// implementation plan a building pipeline can execute, looped explore → plan → execute → eval until
// the plan scores at or above the locked threshold with no critical failures. Read-only on the
// product — the only write is the technical plan under runs/<run-id>/. It plans the HOW; it does
// not build. maker (execute) != verifier (eval); eval runs on a different model. One runId is minted
// once and threaded through every stage (memory/errors.md).
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'technical-plan',
  description: 'Turn an approved spec or scoped need into one grounded, sequenced technical implementation plan a building pipeline can execute',
  phases: [{ title: 'Frame' }, { title: 'Draft loop' }],
}

const P = 'agent-loop/pipelines/technical-plan'
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code). Pass
// `--provider=gpt` to route every stage to codex. READ=explore/plan, MAKE=execute, VERIFY=eval
// (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TICKET = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: technical-plan)'
const MAX = 3

const FRAME = { type: 'object', required: ['accepted', 'runId'],
  properties: {
    accepted: { type: 'boolean' },
    runId: { type: 'string' },
    targetType: { type: 'string' },   // the building type this plan will resolve to
    intent: { type: 'string' },
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
    'sectionsComplete', 'referencesResolve', 'layersComplete', 'sequenced', 'scopeBounded',
    'constraintsRespected', 'openQuestionsListed'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    sectionsComplete: { type: 'boolean' },     // required section contract present
    referencesResolve: { type: 'boolean' },    // every file/service/table/action/route cited exists (anti-hallucination)
    layersComplete: { type: 'boolean' },       // every layer needed to ship is covered (data → service → action → UI → tests → migration)
    sequenced: { type: 'boolean' },            // steps are ordered and buildable, each on the last
    scopeBounded: { type: 'boolean' },         // one slice; explicit out-of-scope; no epic creep
    constraintsRespected: { type: 'boolean' }, // plan honors CLAUDE.md standing constraints
    openQuestionsListed: { type: 'boolean' },  // owner-only decisions surfaced, not invented
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Frame')
const frame = await agent(
  `You are the EXPLORE stage of the technical-plan pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\` to orient before reading code. Apply the scope gate: accept only an
   ALREADY-APPROVED scope or spec that needs a technical HOW — the architecture, file-by-file
   change list, layered touchpoints, and build sequence a building pipeline will execute. Refuse
   when the request still needs its WHAT/scope decided (route to \`spec\`), is a question about the
   world or codebase (route to \`research\`), is already precise enough to build as-is, or is an
   owner-only judgment. Map the real code the plan must cite. Return accepted, runId, the downstream
   building targetType, and a one-line intent. If it is not a technical-planning task, set
   accepted=false and explain in note — do not invent scope.`,
  { label: 'explore', schema: FRAME, ...TIER.read })

if (!frame.accepted) {
  log(`STOP: not a technical-plan task — ${frame.note || 'see explore notes'}. Routed elsewhere or returned.`)
  return { planned: false, note: frame.note }
}

const RUN = frame.runId
log(`run ${RUN} — framed. downstream target: ${frame.targetType || 'tbd'}`)

phase('Draft loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Intent: ${frame.intent}. Downstream target: ${frame.targetType}.
     ${last ? `Previous attempt failed: ${last}. Adjust.` : ''}
     Decide the technical plan's structure and scope boundaries for this request, name the
     downstream building pipeline it resolves to, and author the task-specific 100-point Eval rubric
     required by plan.md (grounding, layer completeness, buildable sequencing, boundedness,
     constraint fidelity, and honest open questions are critical). Hash the exact Eval-rubric section
     with SHA-256 and return rubricReady, passThreshold, and rubricSha256. On retries keep that
     section byte-for-byte unchanged unless a human approved a rubric change.`,
    { label: `plan#${i}`, phase: 'Draft loop', schema: PLAN, ...TIER.read })

  if (!plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${plan.reason || 'see plan.md'}`)
    return { planned: false, invalidRubric: true, iterations: i, runId: RUN }
  }

  if (lockedRubricSha256 === null) {
    lockedRubricSha256 = plan.rubricSha256
    lockedPassThreshold = plan.passThreshold
  } else if (plan.rubricSha256 !== lockedRubricSha256 || plan.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval rubric or threshold changed after scoring began; human approval is required.')
    return { planned: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\`. Write the complete technical plan (technical-plan.md) exactly as the
     plan describes: the architecture decision(s), a file-by-file change list (each create/modify a
     real existing path or a justified new one), the layers touched (data/schema, service, action,
     UI, tests, migration if needed), the ordered implementation sequence, rollback, and risks.
     Ground every reference in real code. Do NOT edit product source, schema, migrations, seed data,
     the database, or the live orchestrator inbox. If the plan is wrong, stop and report — don't
     improvise architecture.`,
    { label: `execute#${i}`, phase: 'Draft loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Independently resolve every file, service,
     action, route, and table the plan cites with \`graphify\` and file reads (an unresolved or
     invented reference is a critical failure), confirm every layer needed to ship is covered,
     confirm the steps are ordered and each is buildable on the last, confirm scope is one bounded
     slice with explicit out-of-scope, confirm the plan honors CLAUDE.md, and confirm owner-only
     decisions are listed as open questions rather than invented. Apply the locked rubric at SHA-256
     ${lockedRubricSha256} and threshold ${lockedPassThreshold}/100. Return score, passThreshold,
     criticalFailures, rubricValid, rubricSha256, and the section booleans.`,
    { label: `eval#${i}`, phase: 'Draft loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · grounded ${v.referencesResolve ? 'yes' : 'NO'} · layers ${v.layersComplete ? 'yes' : 'NO'} · sequenced ${v.sequenced ? 'yes' : 'NO'} · bounded ${v.scopeBounded ? 'yes' : 'NO'}`)

  if (v.rubricSha256 !== lockedRubricSha256 || v.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval observed a changed rubric fingerprint or threshold; human approval is required.')
    return { planned: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  if (v.verdict === 'pass' && v.rubricValid && v.rubricSha256 === lockedRubricSha256 && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.sectionsComplete && v.referencesResolve && v.layersComplete && v.sequenced && v.scopeBounded && v.constraintsRespected && v.openQuestionsListed) {
    // Planning gate: a passing technical plan is NOT auto-dispatched. The owner approves the
    // architecture and sequence, then hands technical-plan.md to the matching building pipeline.
    log(`TECHNICAL PLAN READY: review ${P}/runs/${RUN}/technical-plan.md, then hand it to the ${frame.targetType || 'matching building'} pipeline to build it.`)
    return { planned: true, awaitingPlanApproval: true, iterations: i, targetType: frame.targetType, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'} · grounded ${v.referencesResolve ? 'yes' : 'no'} · layers ${v.layersComplete ? 'yes' : 'no'} · sequenced ${v.sequenced ? 'yes' : 'no'}`
}

log(`STOP: no passing technical plan within ${MAX} iterations — handing back to a human.`)
return { planned: false, iterations: i, runId: RUN }
