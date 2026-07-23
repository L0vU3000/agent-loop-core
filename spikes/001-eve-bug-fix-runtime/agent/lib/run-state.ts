import { defineState } from "eve/context";
import type { RunState } from "./runtime-adapter.mjs";

export const bugFixRun = defineState<RunState | null>("agent-loop-core.bug-fix-run", () => null);
