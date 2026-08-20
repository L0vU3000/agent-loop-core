# Auto Mode - Milestone B

Auto Mode is a deterministic, safety-first admission layer for the agent loop. It ensures that only "safe" work items are claimed for automated processing, preventing the agent from accidentally triggering protected actions or violating host policies without human oversight.

## Milestone B Implementation

This version implements the **Deterministic Safe Admission** and **Evidence Bundling** phases.

### Core Capabilities
- **Safe Selection**: Scans the current dispatch plan and selects at most ONE eligible work item.
- **Safe Admission**: 
    - Only allows categories: `planning`, `review`, `maintenance`, `testing`, `building`.
    - Rejects any item that matches a protected action pattern (e.g., production deploys, sensitive git ops) defined in `fable-gate.mjs`.
    - Rejects `delivery` category items (always paused).
- **Atomic Claim**: Integrates with `claimItem` to ensure the selected item is marked in-progress atomically.
- **Evidence Bundling**: Creates a metadata-only bundle for future Fable (decision model) calls. The bundle contains:
    - Schema version and item identity.
    - Category and Type.
    - A strictly bounded objective derived from the `Done =` line of the work item.
    - Validated lists of changed files and gate references.
    - A reference to the Fable prompt.

### Invariants & Restrictions
- **No Execution**: Auto Mode does NOT execute workflows or any shell commands.
- **No Model Invocation**: Auto Mode does NOT call Fable or any other LLM.
- **No Outcome Recording**: Auto Mode does NOT record pass/fail outcomes.
- **No Scheduling**: There is no cron or timing mechanism in this module.
- **Metadata Only**: Evidence bundles contain no raw item bodies, diffs, logs, or secrets.

## Future Work
- **Night Shift**: A future preset that will apply the same safety policies and lower budgets/one-item cap as Auto Mode, but is deferred and not scheduled.
- **Fable Integration**: Implementation of the actual model call using the evidence bundle produced here.
