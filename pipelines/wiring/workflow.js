// wiring — automated pipeline runtime (built-in Workflow, no external deps).
// Pattern: pin each shown value to its real backing field with failing traceability
// assertions (explore) → plan → execute → eval, looped until every in-scope value is wired
// (assertions green, no mocks left, surface renders) with no regressions. maker (execute) !=
// verifier (eval); eval on a different model. A single runId is minted once and threaded
// through every stage (lesson from memory/errors.md — do not let stages invent their own).
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'wiring',
  description: 'Replace mock/placeholder/hardcoded values on one surface with real data wired from lib/services, pinned by red-to-green traceability assertions',
  phases: [{ title: 'Pin' }, { title: 'Wire loop' }],
}

const P = 'agent-loop/pipelines/wiring'
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
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: wiring)'
const MAX = 6

const SPEC = { type: 'object', required: ['scoped', 'runId'],
  properties: {
    scoped: { type: 'boolean' },
    runId: { type: 'string' },
    assertionPath: { type: 'string' },
    values: { type: 'string' },
    routeTo: { type: 'string' },
    note: { type: 'string' },
  } }

const PLAN = { type: 'object', required: ['rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  } }

const VERDICT = { type: 'object', required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256', 'valuesTraceable', 'noMocksRemain', 'surfaceRenders', 'suiteGreen', 'tscErrors', 'noNewEslintWarnings'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    valuesTraceable: { type: 'boolean' },
    noMocksRemain: { type: 'boolean' },
    surfaceRenders: { type: 'boolean' },
    suiteGreen: { type: 'boolean' },
    tscErrors: { type: 'number' },
    noNewEslintWarnings: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Pin')
const spec = await agent(
  `You are the EXPLORE stage of the wiring pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\` to orient before reading code. List every mock/placeholder/hardcoded
   value on the named surface, find each value's real backing schema field or named derivation,
   and write FAILING traceability assertion(s) that pin each value to its field (confirm they
   are red for the right reason — the surface renders a literal, not the real value). Apply the
   SCOPE GATE: if a value has no backing field/derivation yet, or wiring needs new product
   behavior, set scoped=false and put the target pipeline (entity | migration | feature) in
   routeTo. Return scoped, runId, assertionPath, and a one-line values summary. Do not invent
   a data source.`,
  { label: 'explore', schema: SPEC, ...TIER.read })

if (!spec.scoped) {
  log(`STOP: out of wiring scope — ${spec.note || 'see explore notes'}. Route to ${spec.routeTo || 'entity/migration/feature'}.`)
  return { scoped: false, routeTo: spec.routeTo, note: spec.note }
}

const RUN = spec.runId
log(`run ${RUN} — pinned. traceability assertions: ${spec.assertionPath}`)

phase('Wire loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     In-scope values: ${spec.values}. Failing assertions: ${spec.assertionPath}.
     ${last ? `Previous attempt failed: ${last}. Adjust.` : ''}
     Plan the smallest wiring that turns every traceability assertion green (each value read
     from lib/services through a Server Action/Component). Add no new schema. Create the
     task-specific 100-point Eval rubric required by plan.md. Hash the exact Eval-rubric section
     with SHA-256 and return rubricReady, passThreshold, and rubricSha256. On retries, keep that
     section byte-for-byte unchanged unless a human approved a rubric change.`,
    { label: `plan#${i}`, phase: 'Wire loop', schema: PLAN, ...TIER.read })

  if (!plan.rubricReady || !plan.rubricSha256 || plan.passThreshold < 80 || plan.passThreshold > 100) {
    log(`STOP: Plan did not produce a valid Eval rubric — ${plan.reason || 'see plan.md'}`)
    return { wired: false, invalidRubric: true, iterations: i, runId: RUN }
  }

  if (lockedRubricSha256 === null) {
    lockedRubricSha256 = plan.rubricSha256
    lockedPassThreshold = plan.passThreshold
  } else if (plan.rubricSha256 !== lockedRubricSha256 || plan.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval rubric or threshold changed after scoring began; human approval is required.')
    return { wired: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\`. Wire exactly what the plan describes — replace each mock/placeholder/
     hardcoded literal with the real value from lib/services. Add NO new schema. Do NOT modify
     the traceability assertions to make them pass. If the plan is wrong, stop and report —
     don't improvise.`,
    { label: `execute#${i}`, phase: 'Wire loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. For every in-scope value, cite the real
     schema field or derivation it now reads from (valuesTraceable). Grep the wired file(s) for
     the listed literals — none may remain in scope (noMocksRemain). Run the traceability
     assertions at ${spec.assertionPath} (must go green, unmodified) and confirm the surface
     renders with real data (surfaceRenders). Run \`npx vitest run\` (whole suite green),
     \`npx tsc --noEmit\` (0 errors), and \`${LINT}\` (no new warnings). Return the verdict with
     cited evidence. Apply the locked rubric at SHA-256 ${lockedRubricSha256} and threshold
     ${lockedPassThreshold}/100. Return score, passThreshold, criticalFailures, rubricValid,
     rubricSha256, valuesTraceable, noMocksRemain, surfaceRenders, suiteGreen, tscErrors,
     noNewEslintWarnings, and cited evidence.`,
    { label: `eval#${i}`, phase: 'Wire loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · traceable ${v.valuesTraceable ? 'yes' : 'NO'} · mocks ${v.noMocksRemain ? 'none' : 'REMAIN'} · renders ${v.surfaceRenders ? 'yes' : 'NO'} · suite ${v.suiteGreen ? 'green' : 'RED'} · tsc ${v.tscErrors} · eslint ${v.noNewEslintWarnings ? 'no-new-warnings' : 'REGRESSED'}`)

  if (v.rubricSha256 !== lockedRubricSha256 || v.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval observed a changed rubric fingerprint or threshold; human approval is required.')
    return { wired: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  if (v.verdict === 'pass' && v.rubricValid && v.rubricSha256 === lockedRubricSha256 && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.valuesTraceable && v.noMocksRemain && v.surfaceRenders && v.suiteGreen && v.tscErrors === 0 && v.noNewEslintWarnings) {
    log(`DONE: surface wired to real data and guarded by ${spec.assertionPath}`)
    return { wired: true, iterations: i, assertionPath: spec.assertionPath, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'} · traceable ${v.valuesTraceable ? 'yes' : 'no'} · mocks ${v.noMocksRemain ? 'none' : 'remain'} · lint ${v.noNewEslintWarnings ? 'unchanged' : 'regressed'} · evidence ${v.evidence || 'none cited'}`
}

log(`STOP: not wired within ${MAX} iterations — handing back to a human.`)
return { wired: false, iterations: i, runId: RUN }
