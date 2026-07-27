import { defineTool } from "eve/tools";
import { z } from "zod";
import { bugFixRun } from "../lib/run-state.js";

export default defineTool({
  description: "Read the current durable bug-fix run state without changing it.",
  inputSchema: z.object({}),
  execute() {
    const current = bugFixRun.get();
    if (!current) throw new Error("RUN_NOT_INITIALIZED");
    return {
      runId: current.runId,
      phase: current.phase,
      iteration: current.iteration,
      rubricSha256: current.rubric?.sha256 ?? null,
      makerCommit: current.makerArtifact?.commit ?? null,
    };
  },
});
