// api-tool — automated pipeline runtime (built-in Workflow, no external deps).
// Pattern: ground + specify with a failing tool test (explore) → plan → execute → eval, looped
// until the tool test goes green and the surface is safe (authz enforced, input validated, no
// error leak) with no regressions. maker (execute) != verifier (eval); eval on a different
// model. A single runId is minted once and threaded through every stage (lesson from
// memory/errors.md — do not let stages invent their own).
//
// This pipeline WRAPS an existing lib/services/* function over the tool surface (MCP tool or API
// endpoint) through the ctxFor() seam. It adds no new business logic and no schema; if the
// service is missing, explore refuses and routes to feature/entity/migration.
//
// Isolation: execute runs in a git worktree (harness-provided), so the maker's edits never touch
// the live tree; see pipeline.md Guardrails. Data-touching services use a Neon dev branch only.
//
// Pass the ticket path as args, e.g. Workflow({scriptPath, args: 'agent-loop/orchestrator/inbox/<ticket>.md'})

export const meta = {
  name: 'api-tool',
  description: 'Wrap one existing lib/services function as a new MCP tool / API endpoint via ctxFor: validate input, enforce the service authorization, hide internal errors, prove it end-to-end',
  phases: [{ title: 'Specify' }, { title: 'Wire loop' }],
}

const P = 'agent-loop/pipelines/api-tool'
const LINT = 'npx eslint app lib components mcp-server'
// Provider-adaptive model tiers — Anthropic by default (the loop runs under Claude Code, so the
// session is Claude). Pass `--provider=gpt` in args to route every stage to codex
// (gpt-5.1-codex-max), effort as the cheap→deep gradient. READ=explore/plan, MAKE=execute,
// VERIFY=eval (a separate agent either way, so maker!=verifier holds).
const PROVIDER = /(^|\s)--provider=gpt(\s|$)/.test(args || '') ? 'gpt' : 'anthropic'
const TIER = PROVIDER === 'gpt'
  ? { read: { agentType: 'codex', effort: 'low' }, make: { agentType: 'codex', effort: 'high' }, verify: { agentType: 'codex', effort: 'medium' } }
  : { read: { model: 'sonnet' }, make: { model: 'opus' }, verify: { model: 'sonnet' } }

const TICKET = (args || '').replace(/\s*--provider=\S+/, '').trim()
  || '(no ticket path passed — read the newest agent-loop/orchestrator/inbox/*.md with type: api-tool)'
const MAX = 6

const SPEC = { type: 'object', required: ['specified', 'runId'],
  properties: {
    specified: { type: 'boolean' },
    runId: { type: 'string' },
    testPath: { type: 'string' },
    serviceFn: { type: 'string' },
    note: { type: 'string' },
  } }

const PLAN = { type: 'object', required: ['rubricReady', 'passThreshold', 'rubricSha256'],
  properties: {
    rubricReady: { type: 'boolean' },
    passThreshold: { type: 'number' },
    rubricSha256: { type: 'string' },
    reason: { type: 'string' },
  } }

const VERDICT = { type: 'object', required: ['verdict', 'score', 'passThreshold', 'criticalFailures', 'rubricValid', 'rubricSha256', 'toolWorks', 'authzEnforced', 'inputValidated', 'noErrorLeak', 'suiteGreen', 'tscErrors', 'noNewEslintWarnings'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    score: { type: 'number' },
    passThreshold: { type: 'number' },
    criticalFailures: { type: 'number' },
    rubricValid: { type: 'boolean' },
    rubricSha256: { type: 'string' },
    toolWorks: { type: 'boolean' },
    authzEnforced: { type: 'boolean' },
    inputValidated: { type: 'boolean' },
    noErrorLeak: { type: 'boolean' },
    suiteGreen: { type: 'boolean' },
    tscErrors: { type: 'number' },
    noNewEslintWarnings: { type: 'boolean' },
    evidence: { type: 'string' },
    reason: { type: 'string' },
  } }

phase('Specify')
const spec = await agent(
  `You are the EXPLORE stage of the api-tool pipeline. Follow ${P}/explore.md.
   Ticket: ${TICKET}.
   First mint ONE run-id for this whole execution: \`date "+%Y-%m-%d-%H%M%S"\`, then
   \`mkdir -p ${P}/runs/<run-id>\` — every later stage writes ONLY into that folder.
   Use \`graphify query\` to orient before reading code. CONFIRM the target lib/services/*
   function already exists — this pipeline only WRAPS existing behavior over the tool surface
   through ctxFor(); it adds no new business logic and no schema. If the service is missing, set
   specified=false and note that it needs feature/entity/migration first. Otherwise write a
   FAILING tool test (happy path + cross-tenant rejection + malformed-input rejection) that
   drives the tool end-to-end through ctxFor() (confirm it is red for the right reason — the tool
   is absent). Return specified, runId, testPath, and the serviceFn being wrapped. If the
   caller-facing shape is ambiguous, set specified=false and explain in note — do not invent it.`,
  { label: 'explore', schema: SPEC, ...TIER.read })

if (!spec.specified) {
  log(`STOP: could not specify — ${spec.note || 'see explore notes'}. Ticket goes back (missing service or unclear shape → feature/entity/migration).`)
  return { specified: false, note: spec.note }
}

const RUN = spec.runId
log(`run ${RUN} — specified. tool test: ${spec.testPath} · wraps: ${spec.serviceFn}`)

phase('Wire loop')
let i = 0
let last = null
let lockedRubricSha256 = null
let lockedPassThreshold = null
while (i < MAX) {
  i++

  const plan = await agent(
    `You are the PLAN stage. Follow ${P}/plan.md. Write only into \`${P}/runs/${RUN}/\`.
     Wrapping service fn: ${spec.serviceFn}. Failing tool test: ${spec.testPath}.
     ${last ? `Previous attempt failed: ${last}. Adjust the wiring (NOT the rubric).` : ''}
     Plan the smallest wiring that makes the tool test pass — a THIN wrapper over the existing
     service through ctxFor(), reusing the site's existing Zod schema, no new logic or schema.
     Create the task-specific 100-point Eval rubric required by plan.md, with authorization
     enforced, input validated, and no error leakage as the heaviest CRITICAL criteria. Hash the
     exact Eval-rubric section with SHA-256 and return rubricReady, passThreshold, and
     rubricSha256. On retries, keep that section byte-for-byte unchanged unless a human approved a
     rubric change.`,
    { label: `plan#${i}`, phase: 'Wire loop', schema: PLAN, ...TIER.read })

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

  await agent(
    `You are the EXECUTE stage (MAKER). Follow ${P}/execute.md. Write only into
     \`${P}/runs/${RUN}/\`. Wire exactly what the plan describes — a thin tool wrapper over the
     existing service through ctxFor(), input validated by the existing Zod schema, generic
     client errors only. Do NOT modify the tool test to make it pass. Do NOT add business logic,
     schema, or re-implement the service's authorization. If the plan is wrong, stop and report —
     don't improvise.`,
    { label: `execute#${i}`, phase: 'Wire loop', ...TIER.make })

  const v = await agent(
    `You are the EVAL stage (VERIFIER — a DIFFERENT agent from the maker). Follow ${P}/eval.md.
     Write your verdict to \`${P}/runs/${RUN}/eval.md\`. Run the tool test at ${spec.testPath}
     (must go green, unmodified; drives happy path + cross-tenant rejection + malformed-input
     rejection through ctxFor()), confirm the tool wraps the real service with no new logic,
     \`npx vitest run\` (whole suite green), \`npx tsc --noEmit\` (0 errors), and \`${LINT}\`
     (no new warnings). Return the verdict with cited evidence. Apply the locked rubric at
     SHA-256 ${lockedRubricSha256} and threshold ${lockedPassThreshold}/100. Return score,
     passThreshold, criticalFailures, rubricValid, rubricSha256, toolWorks, authzEnforced,
     inputValidated, noErrorLeak, suiteGreen, tscErrors, noNewEslintWarnings, and cited evidence.`,
    { label: `eval#${i}`, phase: 'Wire loop', schema: VERDICT, ...TIER.verify })

  log(`iter ${i}: score ${v.score}/${v.passThreshold} · critical ${v.criticalFailures} · tool ${v.toolWorks ? 'works' : 'BROKEN'} · authz ${v.authzEnforced ? 'enforced' : 'LEAK'} · input ${v.inputValidated ? 'validated' : 'UNVALIDATED'} · errors ${v.noErrorLeak ? 'hidden' : 'LEAKED'} · suite ${v.suiteGreen ? 'green' : 'RED'} · tsc ${v.tscErrors} · eslint ${v.noNewEslintWarnings ? 'no-new-warnings' : 'REGRESSED'}`)

  if (v.rubricSha256 !== lockedRubricSha256 || v.passThreshold !== lockedPassThreshold) {
    log('STOP: Eval observed a changed rubric fingerprint or threshold; human approval is required.')
    return { built: false, rubricChangeNeedsApproval: true, iterations: i, runId: RUN }
  }

  if (v.verdict === 'pass' && v.rubricValid && v.rubricSha256 === lockedRubricSha256 && v.passThreshold === lockedPassThreshold && v.score >= lockedPassThreshold && v.criticalFailures === 0 && v.toolWorks && v.authzEnforced && v.inputValidated && v.noErrorLeak && v.suiteGreen && v.tscErrors === 0 && v.noNewEslintWarnings) {
    log(`DONE: tool wired and guarded by ${spec.testPath} (wraps ${spec.serviceFn})`)
    return { built: true, iterations: i, testPath: spec.testPath, serviceFn: spec.serviceFn, runId: RUN }
  }
  last = `score ${v.score}/${lockedPassThreshold}, critical failures ${v.criticalFailures}: ${v.reason || v.evidence || 'checks failed'} · authz ${v.authzEnforced ? 'ok' : 'FAILED'} · input ${v.inputValidated ? 'ok' : 'FAILED'} · no-leak ${v.noErrorLeak ? 'ok' : 'FAILED'} · lint ${v.noNewEslintWarnings ? 'unchanged' : 'regressed'} · evidence ${v.evidence || 'none cited'}`
}

log(`STOP: not wired safely within ${MAX} iterations — handing back to a human.`)
return { built: false, iterations: i, runId: RUN }
