import { evaluateGate } from './fable-gate.mjs';

/**
 * Validates and sanitizes a Fable bundle.
 * @param {Object} bundle
 * @returns {Object} Sanitized bundle
 * @throws {Error} If validation fails
 */
export function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('Bundle must be an object');
  }

  if (bundle.schemaVersion !== '1.0.0') {
    throw new Error('Invalid schemaVersion: must be 1.0.0');
  }

  if (typeof bundle.identity !== 'string') {
    throw new Error('Invalid identity: must be a string');
  }
  const identity = bundle.identity;
  if (identity.length === 0 || identity.length > 160) {
    throw new Error('Invalid identity: length must be 1-160');
  }
  if (!identity.endsWith('.md')) {
    throw new Error('Invalid identity: must end with .md');
  }
  if (identity === '.' || identity === '..' || identity === '.md' || identity === '..md') {
    throw new Error('Invalid identity: cannot be . or ..');
  }
  if (identity.includes('/') || identity.includes('\\') || /[\u0000-\u001F\u007F-\u009F]/.test(identity)) {
    throw new Error('Invalid identity: no control characters or path separators (/ \\)');
  }

  const validCategories = ['planning', 'review', 'maintenance', 'testing', 'building'];
  if (!validCategories.includes(bundle.category)) {
    throw new Error(`Invalid category: must be one of ${validCategories.join(', ')}`);
  }

  if (typeof bundle.type !== 'string') {
    throw new Error('Invalid type: must be a string');
  }
  const type = bundle.type.trim();
  if (type.length === 0 || type.length > 160 || /[\u0000-\u001F\u007F-\u009F]/.test(type)) {
    throw new Error('Invalid type: must be non-empty string <= 160 without control characters');
  }

  if (typeof bundle.objective !== 'string') {
    throw new Error('Invalid objective: must be a string');
  }
  const objective = bundle.objective.trim();
  if (objective.length === 0 || objective.length > 240 || /[\u0000-\u001F\u007F-\u009F]/.test(objective)) {
    throw new Error('Invalid objective: must be non-empty string <= 240 without control characters');
  }

  const validateArray = (arr, name) => {
    if (!Array.isArray(arr) || arr.length > 50) {
      throw new Error(`Invalid ${name}: must be array of 0-50 items`);
    }
    for (const item of arr) {
      if (typeof item !== 'string' || item.length === 0 || item.length > 240 || /[\u0000-\u001F\u007F-\u009F]/.test(item)) {
        throw new Error(`Invalid ${name} item: must be non-empty string <= 240 without control characters`);
      }
      if (item.startsWith('/') || item.startsWith('http') || item.includes('..')) {
        throw new Error(`Invalid ${name} item: no absolute paths, URLs, or traversal`);
      }
      const sensitive = /api[-_ ]?key|secret|token|password|credential|private[-_ ]?key/i;
      if (sensitive.test(item)) {
        throw new Error(`Invalid ${name} item: sensitive information detected`);
      }
    }
  };

  validateArray(bundle.changedFiles, 'changedFiles');
  validateArray(bundle.gateReferences, 'gateReferences');

  if (bundle.fablePromptPath !== 'orchestrator/fable-decision-prompt.md') {
    throw new Error('Invalid fablePromptPath: must be orchestrator/fable-decision-prompt.md');
  }

  if (bundle.note !== 'Auto Mode does NOT invoke Fable') {
    throw new Error('Invalid note: must be "Auto Mode does NOT invoke Fable"');
  }

  // Return only allowed fields
  return {
    schemaVersion: bundle.schemaVersion,
    identity: identity,
    category: bundle.category,
    type: type,
    objective: objective,
    changedFiles: [...bundle.changedFiles],
    gateReferences: [...bundle.gateReferences],
    fablePromptPath: bundle.fablePromptPath,
    note: bundle.note,
  };
}

/**
 * Builds a compact Fable request payload.
 * @param {Object} bundle
 * @returns {Object} Compact request
 */
export function buildFableRequest(bundle) {
  const sanitized = validateBundle(bundle);
  return { ...sanitized };
}

/**
 * Requests a decision from Fable using an injected transport.
 * @param {Object} bundle
 * @param {Object} options
 * @returns {Promise<{ outcome, rationale, stateUpdate }>}
 */
export async function requestFableDecision(bundle, { invokeFable, state = {} } = {}) {
  if (!invokeFable || typeof invokeFable !== 'function') {
    throw new Error('invokeFable transport function is required');
  }

  // 1. Validate bundle before any transport
  validateBundle(bundle);

  // 2. Build request
  const request = buildFableRequest(bundle);

  try {
    // 3. Single invocation of injected transport
    const response = await invokeFable(request);

    // 4. Evaluate response using Fable Gate logic
    return evaluateGate(response, state);
  } catch (error) {
    // Fail-closed on transport error
    return { 
      outcome: 'PAUSE_OWNER', 
      rationale: 'Fable transport failed', 
      stateUpdate: null 
    };
  }
}
