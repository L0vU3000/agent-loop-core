import { loadRecordedEvidence } from '../core/evidence.mjs'
import { resolveWorkItem } from '../core/work-items.mjs'
import { deriveRepositoryState } from '../paths/repository-state.mjs'

function freezeReport(report) {
  return Object.freeze({ ...report, json: Object.freeze({ ...report.json }) })
}

function failureReport(code) {
  return freezeReport({
    exitCode: 3,
    json: { schemaVersion: 1, error: code },
    human: `Recovery result: internal failure (${code}).\n`,
  })
}

export function runAgentLoopRecover(options, {
  env = process.env,
  deriveRepositoryStateFn = deriveRepositoryState,
  loadRecordedEvidenceFn = loadRecordedEvidence,
  resolveWorkItemFn = resolveWorkItem,
} = {}) {
  let state
  try {
    state = deriveRepositoryStateFn({
      repositoryPath: options.repo,
      stateRoot: options.stateRoot,
      env,
    })
  } catch {
    return failureReport('RECOVERY_STATE_UNAVAILABLE')
  }

  let recorded
  try {
    recorded = loadRecordedEvidenceFn({ paths: state.paths, runId: options.runId })
  } catch {
    return failureReport('RECORDED_EVIDENCE_UNAVAILABLE')
  }

  if (recorded.run.repositoryKey !== state.repositoryKey) {
    return failureReport('REPOSITORY_STATE_MISMATCH')
  }

  try {
    resolveWorkItemFn({
      paths: state.paths,
      workItemDigest: recorded.run.workItemDigest,
      outcome: recorded.record.decision,
    })
  } catch {
    return failureReport('WORK_ITEM_RECOVERY_FAILED')
  }

  const json = {
    schemaVersion: 1,
    runId: recorded.run.runId,
    decision: recorded.record.decision,
    evidencePath: recorded.evidencePath,
    evidenceDigest: recorded.evidenceDigest,
    stateRoot: state.stateRoot,
    recovered: true,
  }
  const human = [
    `Recovered run ${recorded.run.runId}: ${recorded.record.decision.toUpperCase()}`,
    `Evidence: ${recorded.evidencePath} (${recorded.evidenceDigest})`,
    `State root: ${state.stateRoot}`,
    '',
  ].join('\n')
  return freezeReport({
    exitCode: recorded.record.decision === 'pass' ? 0 : 1,
    json,
    human,
  })
}
