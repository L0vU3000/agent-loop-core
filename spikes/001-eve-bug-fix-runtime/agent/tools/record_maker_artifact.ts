import { defineTool } from "eve/tools";
import { z } from "zod";
import { bugFixRun } from "../lib/run-state.js";
import { recordMakerArtifact } from "../lib/runtime-adapter.mjs";

export default defineTool({
  description: "Record the exact task branch and commit produced by the maker for independent verification.",
  inputSchema: z.object({ branch: z.string().min(1), commit: z.string().min(1) }),
  execute(artifact) {
    const current = bugFixRun.get();
    if (!current) throw new Error("RUN_NOT_INITIALIZED");
    const next = recordMakerArtifact(current, artifact);
    bugFixRun.update(() => next);
    return next;
  },
});
