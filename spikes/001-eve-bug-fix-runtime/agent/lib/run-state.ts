import { defineState } from "eve/context";
import type { RunState } from "./runtime-adapter.mjs";

export const bugFixRun = defineState<RunState | null>("agent-control-plane.bug-fix-run", () => null);
