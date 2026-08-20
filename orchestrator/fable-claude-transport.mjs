import { buildFableRequest } from './fable-decision-adapter.mjs';

/**
 * Creates a Fable Claude transport wrapper.
 * @param {Object} deps
 * @param {Function} deps.runClaude - Injected runner function (prompt, config) => Promise<string|Object>
 * @returns {Function} async invokeFable(request)
 */
export function createFableClaudeTransport({ runClaude } = {}) {
  if (!runClaude || typeof runClaude !== 'function') {
    throw new Error('runClaude runner function is required');
  }

  return async function invokeFable(request) {
    // Full adapter-schema sanitization prevents bypass of category/objective/path/sensitive/prompt/note rules
    const sanitizedRequest = buildFableRequest(request);

    // Construct a compact, constrained prompt.
    // Constraint: JSON-only, under 250 tokens, no tools/shell/files/browser/research/delegation/implementation.
    const prompt = `Fable Decision Mode:
Return JSON-only. No prose.
Max 250 tokens.
Forbidden: tools, shell, files, browser, research, delegation, implementation.
Host policy overrides Fable.

Request:
${JSON.stringify(sanitizedRequest)}`;

    // Locked configuration for the spike
    const config = {
      model: 'fable',
      maxTurns: 1,
      allowedTools: '',
    };

    // Single call to injected runner
    return await runClaude(prompt, config);
  };
}
