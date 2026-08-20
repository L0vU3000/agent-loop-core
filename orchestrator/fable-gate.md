# Fable Decision Gate

The Fable Decision Gate is a deterministic, fail-closed validation module that enforces a security boundary between an AI's proposed action and its execution.

## Architecture
This module is a **pure decision engine**. It does not invoke the Fable model, execute tools, or manage the Auto Mode lifecycle. It only validates the *output* of a Fable invocation against a set of hard-coded host policies and state constraints.

## Key Invariants
1. **Fail-Closed:** Any malformed JSON, invalid types, missing required fields, or unknown verdict values result in `PAUSE_OWNER`.
2. **Host Policy Override:** The host policy is hard-coded and absolute. If an action triggers a security violation (e.g., production deploy), the result is `PAUSE_OWNER` regardless of Fable's rationale.
3. **Deterministic Rework:** `REWORK_ONCE` is granted exactly once per identity. Subsequent requests for rework are blocked to `PAUSE_OWNER`.
4. **Strict Input Bounds:** All fields (identity, rationale, etc.) have strict character limits and type requirements.

## Verdicts
- `ACCEPT`: Action is safe.
- `REWORK_ONCE`: One-time allowance for minor correction.
- `REJECT`: Action is fundamentally unsafe.
- `PAUSE_OWNER`: Security violation or system failure.

## Implementation Note
This is a standalone validation utility. It is **not** an implementation of Auto Mode, workflow execution, or scheduling.
