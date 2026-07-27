import { defineTool } from "eve/tools";
import { z } from "zod";
import { bugFixRun } from "../lib/run-state.js";
import { applyVerification } from "../lib/runtime-adapter.mjs";
export default defineTool({
  description: "Apply the independent verifier result to the bounded bug-fix loop.",
  inputSchema: z.object({ verifier: z.string().min(1), verdict: z.enum(["pass", "fail"]), score: z.number().min(0).max(1), commit: z.string().min(1) }),
  execute(result) {
    const current = bugFixRun.get(); if (!current) throw new Error("RUN_NOT_INITIALIZED");
    const next = applyVerification(current, result); bugFixRun.update(() => next); return next;
  },
});
