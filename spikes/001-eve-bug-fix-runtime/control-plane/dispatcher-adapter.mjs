import { claimItem, planDispatch, recordOutcome } from '../../../orchestrator/dispatch.mjs'
import { decideRecordOutcome } from '../agent/lib/runtime-adapter.mjs'

/**
 * Host-side control-plane bridge. This file intentionally lives outside agent/
 * because Eve snapshots only the app runtime and must not bundle the shared queue.
 */
export function claimNextBugFix(agentLoopRoot) {
  const plan = planDispatch(agentLoopRoot)
  if (!plan.registryOk) {
    throw new Error(`pipeline registry is invalid: ${plan.registryErrors.join('; ')}`)
  }

  const item = plan.routable.find((candidate) => candidate.pipeline === 'bug-fix')
  if (!item) return null

  const claim = claimItem(agentLoopRoot, item.file)
  return {
    file: item.file,
    pipeline: item.pipeline,
    workflow: item.workflow,
    claimPath: claim.moved,
  }
}

export function recordClaimedBugFix(agentLoopRoot, file, evidence) {
  const outcome = decideRecordOutcome(evidence)
  const recorded = recordOutcome(
    agentLoopRoot,
    file,
    outcome,
    `eve adapter: verifier=${evidence.verification?.verdict ?? 'missing'}, objective-gate=${evidence.objectiveGate?.passed === true ? 'pass' : 'fail'}`,
  )
  return { outcome, ...recorded }
}
