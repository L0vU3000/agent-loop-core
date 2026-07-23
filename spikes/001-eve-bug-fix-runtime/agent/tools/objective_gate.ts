import { defineTool } from "eve/tools";
import { z } from "zod";
import { bugFixRun } from "../lib/run-state.js";
import { decideRecordOutcome } from "../lib/runtime-adapter.mjs";
export default defineTool({
  description: "Make the final record decision from verifier and objective machine-gate evidence.",
  inputSchema: z.object({ checked: z.boolean(), passed: z.boolean(), detail: z.string().optional() }),
  execute(objectiveGate) {
    const current = bugFixRun.get(); if (!current) throw new Error("RUN_NOT_INITIALIZED");
    if (current.phase !== "objective-gate") throw new Error("OBJECTIVE_GATE_NOT_EXPECTED_IN_CURRENT_PHASE");
    const outcome = decideRecordOutcome({ verification: current.verification, objectiveGate });
    const next = { ...current, objectiveGate, phase: outcome === "pass" ? "completed" : "failed" };
    bugFixRun.update(() => next); return { runId: next.runId, outcome, phase: next.phase };
  },
});
