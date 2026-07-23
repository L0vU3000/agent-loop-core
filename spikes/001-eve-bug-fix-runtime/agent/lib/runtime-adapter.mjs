export function createRunState({ runId, file, maxIterations = 6 }) {
  if (!runId || !file) throw new Error('runId and file are required')
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error('maxIterations must be a positive integer')
  }

  return {
    schemaVersion: 1,
    runId,
    file,
    pipeline: 'bug-fix',
    phase: 'explore',
    iteration: 0,
    maxIterations,
    rubric: null,
    makerArtifact: null,
    verification: null,
    objectiveGate: null,
  }
}

export function lockRubric(state, rubric) {
  if (state.rubric) {
    const unchanged = state.rubric.sha256 === rubric.sha256
      && state.rubric.passThreshold === rubric.passThreshold
    if (!unchanged) throw new Error('RUBRIC_CHANGE_REQUIRES_APPROVAL')
    return state
  }

  return {
    ...state,
    phase: 'execute',
    iteration: 1,
    rubric: { ...rubric },
  }
}

export function recordMakerArtifact(state, artifact) {
  if (state.phase !== 'execute') throw new Error('MAKER_NOT_EXPECTED_IN_CURRENT_PHASE')
  if (!artifact?.branch || !artifact?.commit) throw new Error('branch and commit are required')
  if (state.makerArtifact) {
    const unchanged = state.makerArtifact.branch === artifact.branch
      && state.makerArtifact.commit === artifact.commit
    if (!unchanged) throw new Error('MAKER_ARTIFACT_CHANGE_REQUIRES_NEW_ATTEMPT')
    return state
  }
  return { ...state, makerArtifact: { ...artifact } }
}

export function applyVerification(state, result) {
  if (state.phase !== 'execute') throw new Error('VERIFICATION_NOT_EXPECTED_IN_CURRENT_PHASE')
  if (!state.rubric) throw new Error('rubric must be locked before verification')
  if (!state.makerArtifact) throw new Error('MAKER_ARTIFACT_REQUIRED')
  if (result.commit !== state.makerArtifact.commit) throw new Error('VERIFIER_COMMIT_MISMATCH')
  const passed = result.verdict === 'pass'
    && typeof result.score === 'number'
    && result.score >= state.rubric.passThreshold
  const verification = { ...result, verdict: passed ? 'pass' : 'fail' }

  if (passed) {
    return { ...state, phase: 'objective-gate', verification }
  }
  if (state.iteration >= state.maxIterations) {
    return {
      ...state,
      phase: 'failed',
      verification,
      failureReason: `verification failed at iteration limit ${state.maxIterations}`,
    }
  }
  return {
    ...state,
    phase: 'execute',
    iteration: state.iteration + 1,
    makerArtifact: null,
    verification,
  }
}

export function decideRecordOutcome({ verification, objectiveGate }) {
  return verification?.verdict === 'pass'
    && objectiveGate?.checked === true
    && objectiveGate?.passed === true
    ? 'pass'
    : 'fail'
}
