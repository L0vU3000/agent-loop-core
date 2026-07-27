import { defineAgent } from "eve";
import { mockModel, type MockModelToolResult } from "eve/evals";

function parseFixtureOutput(output: unknown): Record<string, unknown> {
  if (typeof output === "string") return JSON.parse(output) as Record<string, unknown>;
  if (output && typeof output === "object") return output as Record<string, unknown>;
  throw new Error("INVALID_SUBAGENT_OUTPUT");
}

function named(results: readonly MockModelToolResult[], name: string) {
  return results.filter((result) => result.name === name);
}

function latest(results: readonly MockModelToolResult[], name: string) {
  return named(results, name).at(-1);
}

const fixtureModel = mockModel(({ toolResults, userMessageCount }) => {
  if (userMessageCount > 1) {
    const inspection = latest(toolResults, "inspect_state");
    if (!inspection) return { toolCalls: [{ name: "inspect_state", input: {} }] };
    return JSON.stringify(inspection.output);
  }

  if (named(toolResults, "start_run").length === 0) {
    return { toolCalls: [{ name: "start_run", input: { runId: "run-fixture-001", file: "10-fixture-bug.md", maxIterations: 2 } }] };
  }
  if (named(toolResults, "explorer").length === 0) {
    return { toolCalls: [{ name: "explorer", input: { message: "Reproduce the fixture defect and identify its root cause." } }] };
  }
  if (named(toolResults, "planner").length === 0) {
    return { toolCalls: [{ name: "planner", input: { message: "Create the minimal fix plan and evaluation rubric for run-fixture-001." } }] };
  }
  if (named(toolResults, "lock_rubric").length === 0) {
    const planned = parseFixtureOutput(latest(toolResults, "planner")?.output);
    return { toolCalls: [{ name: "lock_rubric", input: { sha256: planned.rubricSha256, passThreshold: planned.passThreshold } }] };
  }

  const applied = named(toolResults, "apply_verification");
  if (applied.length > 0) {
    const transition = parseFixtureOutput(applied.at(-1)?.output);
    if (transition.phase === "failed") return JSON.stringify({ runId: transition.runId, outcome: "fail", phase: "failed" });
    if (transition.phase === "objective-gate") {
      const gate = latest(toolResults, "objective_gate");
      if (!gate) {
        return { toolCalls: [{ name: "objective_gate", input: { checked: true, passed: true, detail: "fixture machinery + typecheck green" } }] };
      }
      return JSON.stringify(gate.output);
    }
  }

  const attempt = applied.length + 1;
  const makers = named(toolResults, "maker");
  if (makers.length < attempt) {
    return { toolCalls: [{ name: "maker", input: { message: `Implement attempt ${attempt} of the approved fixture plan and return the exact task branch and commit.` } }] };
  }

  const artifact = parseFixtureOutput(makers.at(-1)?.output);
  const recordedArtifacts = named(toolResults, "record_maker_artifact");
  if (recordedArtifacts.length < attempt) {
    return { toolCalls: [{ name: "record_maker_artifact", input: { branch: artifact.branch, commit: artifact.commit } }] };
  }

  const verifiers = named(toolResults, "verifier");
  if (verifiers.length < attempt) {
    return { toolCalls: [{ name: "verifier", input: { message: `Independently verify maker commit ${String(artifact.commit)} for attempt ${attempt} against the locked rubric.` } }] };
  }

  const verified = parseFixtureOutput(verifiers.at(-1)?.output);
  if (applied.length < attempt) {
    return { toolCalls: [{ name: "apply_verification", input: { verifier: "verifier", verdict: verified.verdict, score: verified.score, commit: verified.commit } }] };
  }

  throw new Error("UNREACHABLE_FIXTURE_STATE");
});

export default defineAgent({
  model: fixtureModel,
  modelContextWindowTokens: 100_000,
});
