import { defineTool } from "eve/tools";
import { z } from "zod";
import { bugFixRun } from "../lib/run-state.js";
import { lockRubric } from "../lib/runtime-adapter.mjs";
export default defineTool({
  description: "Lock the evaluation rubric before implementation. A changed hash is rejected.",
  inputSchema: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), passThreshold: z.number().min(0).max(1) }),
  execute(rubric) {
    const current = bugFixRun.get(); if (!current) throw new Error("RUN_NOT_INITIALIZED");
    const next = lockRubric(current, rubric); bugFixRun.update(() => next); return next;
  },
});
