#!/usr/bin/env bash
# Smoke self-check for the agent-loop machinery itself ("test the tools").
# Fails loudly (exit 1) if any pipeline's scaffolding is broken:
#   1. every pipelines/*/workflow.js is syntactically valid ESM
#   2. every pipeline has the four stage files + pipeline.md
#   3. every workflow.js pins the shared run-id convention and a maker!=verifier
#      model override on its eval stage
#   4. runs/ folders are gitignored (run state must never be committed)
#   5. update-dashboard.sh actually parses a run folder (fixture round-trip)
#   6. pipeline frontmatter agrees with all three registry tables
#   7. the orchestrator dispatcher routes/validates inbox items against that registry
# Run it after editing any workflow.js or the dashboard script:
#   bash agent-loop/scripts/check-machinery.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # -> agent-loop/

fail=0
say()  { printf '%s\n' "$*"; }
bad()  { say "FAIL  $*"; fail=1; }
good() { say "ok    $*"; }

# --- 1+2+3: per-pipeline checks -------------------------------------------------
for dir in pipelines/*/; do
  name=$(basename "$dir")

  for f in pipeline.md explore.md plan.md execute.md eval.md; do
    if [ ! -f "$dir$f" ]; then
      bad "$name: missing $f"
    fi
  done

  wf="$dir/workflow.js"
  if [ ! -f "$wf" ]; then
    # A pipeline that isn't automated yet is allowed — note it, don't fail.
    say "note  $name: no workflow.js yet (not automated)"
    continue
  fi

  # Syntax check: the Workflow DSL is plain ESM JavaScript, so `node --check`
  # on a .mjs copy validates it without executing anything.
  # (macOS mktemp appends its random suffix at the END, so the .mjs extension has
  # to go on a fixed filename inside a temp dir, not on the template itself.)
  # The Workflow runtime executes the script body inside an async function (top-level
  # `return` and `await` are legal there), so the syntax check wraps it the same way.
  # `export const meta` becomes `const meta` since exports can't live in a function.
  tmpdir=$(mktemp -d -t "wfcheck-$name")
  tmp="$tmpdir/workflow.mjs"
  {
    echo 'async function __wfcheck() {'
    sed 's/^export const meta/const meta/' "$wf"
    echo '}'
  } > "$tmp"
  if node --check "$tmp" 2>/dev/null; then
    good "$name: workflow.js parses"
  else
    bad "$name: workflow.js has a syntax error:"
    node --check "$tmp" 2>&1 | sed 's/^/      /' || true
  fi
  rm -rf "$tmpdir"

  grep -q 'export const meta' "$wf" || bad "$name: workflow.js missing 'export const meta'"

  # Shared run-id lesson (memory/errors.md): explore mints ONE id, later stages reuse it.
  grep -q 'run-id' "$wf" || bad "$name: workflow.js doesn't thread the shared run-id"

  # maker != verifier: the eval agent must carry a model override.
  grep -q "model: 'sonnet'" "$wf" || bad "$name: eval stage has no different-model override"
done

# --- registry metadata -----------------------------------------------------------
# Frontmatter is the canonical routing metadata. The three human-readable registries must
# repeat the same category/type/name triples exactly.
if node --test scripts/check-pipeline-registry.regression.mjs > /dev/null; then
  good "pipeline registry red-to-green regression check passes"
else
  bad "pipeline registry red-to-green regression check failed"
  node --test scripts/check-pipeline-registry.regression.mjs 2>&1 | sed 's/^/      /' || true
fi

if node scripts/check-pipeline-registry.mjs; then
  good "pipeline registry metadata agrees across all sources"
else
  bad "pipeline registry metadata drifted"
fi

# --- orchestrator dispatcher -----------------------------------------------------
# The router must accept well-formed items, reject category/type mismatches and unknown
# types, order by priority, and record outcomes — all against the canonical registry.
if node --test scripts/check-dispatch.regression.mjs > /dev/null; then
  good "orchestrator dispatcher routes/validates inbox items"
else
  bad "orchestrator dispatcher regression check failed"
  node --test scripts/check-dispatch.regression.mjs 2>&1 | sed 's/^/      /' || true
fi

# The record gate re-verifies a claimed PASS at the one doorway before trusting it. It must only
# ever make a verdict stricter (pass→fail), never upgrade a fail, and skip when it cannot run.
if node --test scripts/check-record-gate.regression.mjs > /dev/null; then
  good "record gate re-verifies a claimed pass and only ever downgrades"
else
  bad "record gate regression check failed"
  node --test scripts/check-record-gate.regression.mjs 2>&1 | sed 's/^/      /' || true
fi
# Tripwire: the doorway must actually call the objective gate — not just define it.
if grep -q 'runFastGates' orchestrator/dispatch.mjs && grep -q 'decideRecord' orchestrator/dispatch.mjs; then
  good "record gate is wired into --record (runFastGates + decideRecord)"
else
  bad "record gate is defined but not wired into --record"
fi

# Tripwire: the item-claim lock must actually be wired into the CLI, not just defined — otherwise
# two concurrent ticks can still re-dispatch the same inbox item between dispatch and record.
if grep -q 'claimItem' orchestrator/dispatch.mjs && grep -q -- "'--claim'" orchestrator/dispatch.mjs; then
  good "item-claim lock is wired into --claim (claimItem called from runCli)"
else
  bad "item-claim lock is defined but not wired into --claim"
fi

# The metrics collector turns the runtime's per-stage telemetry into the tuning ledger.
if node --test scripts/check-metrics.regression.mjs > /dev/null; then
  good "metrics collector maps runtime telemetry to ledger rows"
else
  bad "metrics collector regression check failed"
  node --test scripts/check-metrics.regression.mjs 2>&1 | sed 's/^/      /' || true
fi

if node --test scripts/check-eval-scoring.regression.mjs > /dev/null; then
  good "task-specific Eval scoring contract is enforced across every pipeline"
else
  bad "Eval scoring regression check failed"
  node --test scripts/check-eval-scoring.regression.mjs 2>&1 | sed 's/^/      /' || true
fi

# The scoring contract must stay history-aware: Plan reads past failures into each fresh rubric
# (rule 10 + the "Prior failures reviewed" line), and each failure leaves a durable regression
# check. These two rules are what let a per-run rubric still grow from real failures.
if grep -q 'Prior failures reviewed' pipelines/EVAL.md \
  && grep -q 'History-aware' pipelines/EVAL.md \
  && grep -q 'Durable artifact' pipelines/EVAL.md; then
  good "Eval contract is history-aware (carries prior failures forward + leaves a durable check)"
else
  bad "Eval contract lost its history-aware rules (rule 10 / Prior failures reviewed / Durable artifact)"
fi

# The improvement digest projects the metrics ledger + eval scorecards into a ranked backlog —
# the monitoring half of the feedback loop. It must rank real failures above cheap signals and
# never flag a normal approval-gated pause.
if node --test scripts/check-improvement-digest.regression.mjs > /dev/null; then
  good "improvement digest ranks weaknesses and ignores approval pauses"
else
  bad "improvement digest regression check failed"
  node --test scripts/check-improvement-digest.regression.mjs 2>&1 | sed 's/^/      /' || true
fi

# The work-item checker gates chat-drafted tasks before they reach the router. It must accept a
# well-formed item and reject every under-specified one (bad type, mismatched category, no Done
# line) using the SAME registry + frontmatter parser the router uses.
if node --test scripts/check-work-item.regression.mjs > /dev/null; then
  good "work-item checker accepts valid tasks and rejects under-specified ones"
else
  bad "work-item checker regression check failed"
  node --test scripts/check-work-item.regression.mjs 2>&1 | sed 's/^/      /' || true
fi

# e2e-regression must not trust a green suite alone: a run whose open de-flake ticket names a test
# still test.skip-quarantined reports green only because the target never ran. The clean path must
# require explore's ticketedQuarantinesUnskipped flag too, or fail closed into the Fix loop.
if node --test scripts/check-e2e-regression-workflow.regression.mjs > /dev/null; then
  good "e2e-regression clean path requires lifted ticketed quarantines (no green-but-skipped false pass)"
else
  bad "e2e-regression clean-path regression check failed"
  node --test scripts/check-e2e-regression-workflow.regression.mjs 2>&1 | sed 's/^/      /' || true
fi

# entity-scaffold is allowed to touch a development database, so its two approval gates are
# load-bearing. Keep a small static regression check until its first real run adds stronger
# runtime evidence.
entity_workflow="pipelines/entity-scaffold/workflow.js"
if [ -f "$entity_workflow" ]; then
  grep -q 'MIGRATION_APPROVED' "$entity_workflow" \
    && good "entity-scaffold: migration approval gate present" \
    || bad "entity-scaffold: migration approval gate missing"
  grep -q 'migrationSha256' "$entity_workflow" \
    && good "entity-scaffold: approved migration digest is threaded" \
    || bad "entity-scaffold: migration digest check missing"
  grep -q 'replan#' "$entity_workflow" \
    && good "entity-scaffold: eval failure returns to Plan" \
    || bad "entity-scaffold: eval failure does not return to Plan"
  grep -q 'memory#' "$entity_workflow" \
    && good "entity-scaffold: failure memory path present" \
    || bad "entity-scaffold: failure memory path missing"
  grep -q "model: 'opus'" "$entity_workflow" \
    && grep -q "model: 'sonnet'" "$entity_workflow" \
    && good "entity-scaffold: maker and verifier models differ" \
    || bad "entity-scaffold: maker/verifier model split missing"
  if grep -q 'training-off' "$entity_workflow"; then
    bad "entity-scaffold: unproven training mode can be disabled"
  else
    good "entity-scaffold: training mode is locked on"
  fi
fi

# pipeline-improve changes the machinery that guards every other pipeline. Its Plan approval,
# maker/verifier model split, failure memory, and executable stop bounds are load-bearing.
improve_workflow="pipelines/pipeline-improve/workflow.js"
if [ -f "$improve_workflow" ]; then
  grep -q -- '--approved-plan' "$improve_workflow" \
    && good "pipeline-improve: Plan approval gate present" \
    || bad "pipeline-improve: Plan approval gate missing"
  grep -q "model: 'opus'" "$improve_workflow" \
    && grep -q "model: 'sonnet'" "$improve_workflow" \
    && good "pipeline-improve: maker and verifier models differ" \
    || bad "pipeline-improve: maker/verifier model split missing"
  grep -q 'MAX_ATTEMPTS' "$improve_workflow" \
    && grep -q 'MAX_AGENT_CALLS' "$improve_workflow" \
    && grep -q 'TOKEN_CEILING' "$improve_workflow" \
    && grep -q 'repeatCount >= 2' "$improve_workflow" \
    && good "pipeline-improve: attempt, call, token, and no-progress bounds present" \
    || bad "pipeline-improve: executable bounds are incomplete"
  grep -q 'memory#' "$improve_workflow" \
    && good "pipeline-improve: failure memory path present" \
    || bad "pipeline-improve: failure memory path missing"
  grep -q 'GATE RUNNER' "$improve_workflow" \
    && grep -q 'evalCorroborates' "$improve_workflow" \
    && grep -q 'objectiveGreen' "$improve_workflow" \
    && good "pipeline-improve: independent gate runner corroborates the objective gates" \
    || bad "pipeline-improve: eval-gate corroboration missing"
  if grep -q 'training-off' "$improve_workflow"; then
    bad "pipeline-improve: training mode can be disabled"
  else
    good "pipeline-improve: training mode is locked on"
  fi
fi

# Delivery wrappers coordinate external state, so their action-specific approval flags, locked
# training posture, installed-capability boundaries, failure memory, and stop bounds are
# load-bearing. These checks are structural only; they never invoke a delivery capability.
for delivery_pipeline in landing deploy canary release; do
  delivery_workflow="pipelines/$delivery_pipeline/workflow.js"
  if [ ! -f "$delivery_workflow" ]; then
    continue
  fi

  grep -q -- '--approved-plan' "$delivery_workflow" \
    && good "$delivery_pipeline: Plan approval gate present" \
    || bad "$delivery_pipeline: Plan approval gate missing"
  grep -q "model: 'opus'" "$delivery_workflow" \
    && grep -q "model: 'sonnet'" "$delivery_workflow" \
    && good "$delivery_pipeline: maker and verifier models differ" \
    || bad "$delivery_pipeline: maker/verifier model split missing"
  grep -q 'MAX_ATTEMPTS' "$delivery_workflow" \
    && grep -q 'MAX_AGENT_CALLS' "$delivery_workflow" \
    && grep -q 'TOKEN_CEILING' "$delivery_workflow" \
    && grep -q 'repeatCount >= 2' "$delivery_workflow" \
    && good "$delivery_pipeline: attempt, call, token, and no-progress bounds present" \
    || bad "$delivery_pipeline: executable bounds are incomplete"
  grep -q 'memory#' "$delivery_workflow" \
    && grep -q 'replan#' "$delivery_workflow" \
    && good "$delivery_pipeline: failure memory and Eval-to-Plan route present" \
    || bad "$delivery_pipeline: failure memory or Eval-to-Plan route missing"
  if grep -q 'training-off' "$delivery_workflow"; then
    bad "$delivery_pipeline: unproven training mode can be disabled"
  else
    good "$delivery_pipeline: training mode is locked on"
  fi
done

grep -q -- '--approve-merge' pipelines/landing/workflow.js \
  && grep -q 'land-and-deploy' pipelines/landing/workflow.js \
  && good "landing: merge approval and installed landing capability present" \
  || bad "landing: merge approval or installed landing capability missing"

grep -q -- '--approve-deploy' pipelines/deploy/workflow.js \
  && grep -q -- '--approve-production' pipelines/deploy/workflow.js \
  && grep -q 'land-and-deploy' pipelines/deploy/workflow.js \
  && good "deploy: deploy/production approvals and installed capability present" \
  || bad "deploy: deploy/production approval or installed capability missing"

grep -q -- '--approve-rollback' pipelines/canary/workflow.js \
  && grep -q 'land-and-deploy' pipelines/canary/workflow.js \
  && good "canary: rollback approval and installed rollback capability present" \
  || bad "canary: rollback approval or installed rollback capability missing"

grep -q -- '--approve-release' pipelines/release/workflow.js \
  && grep -q -- '--final-signoff=' pipelines/release/workflow.js \
  && grep -q 'document-release' pipelines/release/workflow.js \
  && grep -q 'verified document-release, landing, deploy' pipelines/release/workflow.js \
  && good "release: release approval, final sign-off, and verified prerequisite boundary present" \
  || bad "release: release approval, final sign-off, or verified prerequisite boundary missing"

# --- 4: run state must be gitignored --------------------------------------------
probe="pipelines/eslint-burndown/runs/_ignore-probe"
if git check-ignore -q "$probe"; then
  good "runs/ folders are gitignored"
else
  bad "runs/ folders are NOT gitignored — run state would be committed"
fi

# --- 5: dashboard parser round-trip ----------------------------------------------
# Plant a fixture run with a known verdict, regenerate, assert it shows up as
# completed, then remove the fixture and regenerate again to restore reality.
fixture="pipelines/zz-selfcheck/runs/0000-00-00-000000"
mkdir -p "$fixture"
printf 'verdict: pass\ncoverage: selfcheck 0%% → 100%%\n' > "$fixture/eval.md"
bash scripts/update-dashboard.sh > /dev/null
if grep -q 'zz-selfcheck.*0000-00-00-000000.*pass.*coverage: selfcheck' dashboard.md; then
  good "update-dashboard.sh parses verdict summaries (fixture round-trip)"
else
  bad "update-dashboard.sh did not surface the fixture verdict and summary"
fi
rm -rf "pipelines/zz-selfcheck"
bash scripts/update-dashboard.sh > /dev/null

# --- verdict ---------------------------------------------------------------------
if [ "$fail" -ne 0 ]; then
  say "check-machinery: FAILED"
  exit 1
fi
say "check-machinery: all good"
