export interface Rubric { sha256: string; passThreshold: number }
export interface Verification { verifier: string; verdict: "pass" | "fail"; score: number; commit: string }
export interface ObjectiveGate { checked: boolean; passed: boolean; detail?: string }
export interface MakerArtifact { branch: string; commit: string }
export interface RunState {
  schemaVersion: 1; runId: string; file: string; pipeline: "bug-fix";
  phase: string; iteration: number; maxIterations: number; rubric: Rubric | null;
  makerArtifact: MakerArtifact | null; verification: Verification | null;
  objectiveGate: ObjectiveGate | null; failureReason?: string;
}
export function createRunState(input: { runId: string; file: string; maxIterations?: number }): RunState;
export function lockRubric(state: RunState, rubric: Rubric): RunState;
export function recordMakerArtifact(state: RunState, artifact: MakerArtifact): RunState;
export function applyVerification(state: RunState, result: Verification): RunState;
export function decideRecordOutcome(input: { verification: Verification | null; objectiveGate: ObjectiveGate | null }): "pass" | "fail";
