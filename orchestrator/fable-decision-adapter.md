# Fable Decision Adapter

Strictly manual, dependency-injected adapter for requesting gated decisions from Fable.

## Design Goals
- **Zero Side Effects**: The adapter does not execute work, schedule tasks, or read from the filesystem.
- **Dependency Injection**: Transport (network/API) is injected via the `invokeFable` function.
- **Fail-Closed**: Any transport or validation failure results in `PAUSE_OWNER`.
- **Strict Sanitization**: Bundles are validated against a hard schema to prevent injection or leakage.

## API Contract

### `validateBundle(bundle)`
Validates and sanitizes the input bundle.
- **Allowed Fields**: `schemaVersion` (exactly `1.0.0`), `identity` (md filename <= 160), `category` (planning/review/maintenance/testing/building), `type` (non-empty <= 160), `objective` (non-empty <= 240), `changedFiles` (array 0-50, entries <= 240), `gateReferences` (array 0-50, entries <= 240), `fablePromptPath` (exactly `orchestrator/fable-decision-prompt.md`), `note` (exactly `Auto Mode does NOT invoke Fable`).
- **Constraints**: 
  - `identity`: Must end in `.md`. Cannot be `.` or `..`. No control characters or path separators (`/`, `\`).
  - `type` & `objective`: Trimmed of leading/trailing whitespace. No control characters.
  - String entries: No absolute paths, URLs, traversal, or sensitive keywords (api key, secret, etc.).
- **Returns**: A new object containing only the sanitized allowed fields. `changedFiles` and `gateReferences` are cloned.
- **Throws**: If any validation rule is violated.

### `buildFableRequest(bundle)`
Builds a compact request payload.
- Internally calls `validateBundle`.
- Returns the sanitized bundle.
- Ensures no raw work item bodies or secrets are leaked into the prompt payload.

### `requestFableDecision(bundle, { invokeFable, state = {} } = {})`
The main orchestration function.
1. Validates the bundle.
2. Builds the request.
3. Calls `invokeFable(request)` exactly once.
4. Passes the raw response to `evaluateGate` (from `fable-gate.mjs`).
5. Returns the resulting `{ outcome, rationale, stateUpdate }`.
6. Catches all transport errors and returns `{ outcome: 'PAUSE_OWNER', rationale: 'Fable transport failed', stateUpdate: null }`.

## Safety Regressions
Verification is performed via `scripts/check-fable-decision-adapter.regression.mjs`, which tests:
- Valid bundle sanitization (ignoring unknown fields).
- Exhaustive invalid bundle cases (bounds, types, paths, sensitive words).
- Request builder data leakage prevention.
- Transport failure and malformed response handling.
- Correct integration with `evaluateGate` for `ACCEPT` and `REWORK_ONCE` outcomes.
- Pre-transport validation.
