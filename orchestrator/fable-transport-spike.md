# Fable Claude Transport Spike

## Overview
This transport wrapper provides a capability-minimal, dependency-injected bridge between the `fable-decision-adapter` and a Claude-powered model runner. It is designed for a supervised synthetic one-shot spike.

## Architecture
- **Dependency Injection**: The transport does not know how to call the model. It accepts a `runClaude` function at creation.
- **No Side Effects**: The module contains no imports for filesystem, network, or process management.
- **Locked Configuration**: The transport enforces a strict config for the model runner:
  - `model: 'fable'`
  - `maxTurns: 1`
  - `allowedTools: ''`

## Request Flow
1. `fable-decision-adapter` validates the bundle and calls `buildFableRequest`.
2. The resulting sanitized request is passed to `invokeFable`.
3. `invokeFable` validates the request schema.
4. A compact prompt is constructed containing:
   - Fable Decision Mode instructions (JSON-only, < 250 tokens).
   - The sanitized request JSON.
5. The injected `runClaude` is called exactly once.
6. The raw response from the runner is returned without modification.

## Usage
```javascript
import { createFableClaudeTransport } from './orchestrator/fable-claude-transport.mjs';

const transport = createFableClaudeTransport({
  runClaude: async (prompt, config) => {
    // Host-provided runner implementation
    return await someModelClient.complete(prompt, config);
  }
});

const response = await transport(sanitizedRequest);
```

## Safety Constraints
- **Supervised Spike**: Only fixed synthetic safe bundles may be used.
- **Non-Persistent**: Results are informational and do not trigger any system actions (claim/record/schedule).
- **Self-Contained**: Does not read `fable-decision-prompt.md` or any other external files.
