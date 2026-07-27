import { defineTool } from "eve/tools";
import { z } from "zod";
import { bugFixRun } from "../lib/run-state.js";
import { createRunState } from "../lib/runtime-adapter.mjs";
export default defineTool({
  description: "Initialize one immutable bug-fix run. Replays with the same run id are idempotent.",
  inputSchema: z.object({ runId: z.string().min(1), file: z.string().min(1), maxIterations: z.number().int().positive().max(6) }),
  execute(input) {
    const current = bugFixRun.get();
    if (current) {
      const sameIdentity = current.runId === input.runId
        && current.file === input.file
        && current.maxIterations === input.maxIterations;
      if (!sameIdentity) throw new Error("ACTIVE_RUN_CONFLICT");
      return current;
    }
    const next = createRunState(input);
    bugFixRun.update(() => next);
    return next;
  },
});
