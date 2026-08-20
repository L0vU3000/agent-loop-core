import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Policy categories for protected actions.
 */
export const PROTECTED_CATEGORIES = {
  PRODUCTION: 'production_deploy',
  GIT_SENSITIVE: 'git_sensitive',
  CREDENTIALS: 'credentials_secrets',
  DATABASE: 'database_destructive',
  AUTH_SESSION: 'auth_session_persistent',
  PUBLIC_PUBLISHING: 'public_publishing',
  BILLING_STORE: 'billing_store_submission',
  HISTORY_DELETION: 'history_deletion',
  USER_IMPACT: 'real_user_impact',
};

/**
 * Matches text against protected action patterns.
 * Returns { category, label } or null.
 */
export function matchProtectedAction(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  const patterns = [
    { 
      cat: PROTECTED_CATEGORIES.PRODUCTION, 
      label: 'Production Deployment', 
      regex: /deploy\s+to\s+production|production\s+deploy|vercel\s+deploy|deploy\s+prod/ 
    },
    { 
      cat: PROTECTED_CATEGORIES.GIT_SENSITIVE, 
      label: 'Sensitive Git Operation', 
      regex: /merge\s+into\s+(main|master)|push\s+to\s+(main|master)|force\s+push/ 
    },
    { 
      cat: PROTECTED_CATEGORIES.AUTH_SESSION, 
      label: 'Persistent Auth/Session', 
      regex: /create\s+account|create\s+user|persistent\s+session|auth\s+token/ 
    },
    { 
      cat: PROTECTED_CATEGORIES.CREDENTIALS, 
      label: 'Credential Exposure', 
      regex: /api\s+key|secret|token|password|credential|private\s+key/ 
    },
    { 
      cat: PROTECTED_CATEGORIES.DATABASE, 
      label: 'Destructive Database Operation', 
      regex: /migration|drop\s+table|delete\s+database|truncate\s+table|delete\s+from\s+.*\s+where\s+1=1/ 
    },
    { 
      cat: PROTECTED_CATEGORIES.PUBLIC_PUBLISHING, 
      label: 'Public Publishing', 
      regex: /publish\s+to\s+public|marketing\s+site|privacy\s+policy|terms\s+of\s+service/ 
    },
    { 
      cat: PROTECTED_CATEGORIES.BILLING_STORE, 
      label: 'Billing/Store Submission', 
      regex: /billing|apple\s+developer|testflight|app\s+store\s+submission/ 
    },
    { 
      cat: PROTECTED_CATEGORIES.HISTORY_DELETION, 
      label: 'History Rewrite/Deletion', 
      regex: /rewrite\s+history|git\s+rebase\s+-i|delete\s+history/ 
    },
    { 
      cat: PROTECTED_CATEGORIES.USER_IMPACT, 
      label: 'Real User Impact', 
      regex: /affect\s+all\s+users|broadcast\s+to\s+users|global\s+notification/ 
    },
  ];

  for (const { cat, label, regex } of patterns) {
    if (regex.test(t)) {
      return { category: cat, label };
    }
  }

  return null;
}

/**
 * Pure state update application.
 */
export function applyStateUpdate(state, update) {
  if (!update) return state;
  return {
    ...state,
    ...update,
  };
}

/**
 * Evaluates a Fable verdict against a strict safety contract.
 * Fail-closed to PAUSE_OWNER.
 * 
 * @param {any} rawVerdict - The raw output from Fable (string or object).
 * @param {Object} state - The current gate state.
 * @returns {{ outcome, rationale, stateUpdate }}
 */
export function evaluateGate(rawVerdict, state = {}) {
  let data;
  try {
    data = typeof rawVerdict === 'string' ? JSON.parse(rawVerdict) : rawVerdict;
  } catch {
    return { outcome: 'PAUSE_OWNER', rationale: 'Malformed JSON', stateUpdate: null };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { outcome: 'PAUSE_OWNER', rationale: 'Verdict is not a JSON object', stateUpdate: null };
  }

  const { identity, rationale, requestedAction, evidence, outcome } = data;

  // 1. Strict Type & Bounds Validation
  if (typeof identity !== 'string' || identity.trim().length === 0 || identity.length > 160) {
    return { outcome: 'PAUSE_OWNER', rationale: 'Invalid identity: must be non-empty string <= 160', stateUpdate: null };
  }
  if (typeof rationale !== 'string' || rationale.length > 600) {
    return { outcome: 'PAUSE_OWNER', rationale: 'Invalid rationale: must be string <= 600', stateUpdate: null };
  }
  if (typeof requestedAction !== 'string' || requestedAction.length > 600) {
    return { outcome: 'PAUSE_OWNER', rationale: 'Invalid requestedAction: must be string <= 600', stateUpdate: null };
  }
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 8) {
    return { outcome: 'PAUSE_OWNER', rationale: 'Invalid evidence: must be array of 1-8 items', stateUpdate: null };
  }
  for (const item of evidence) {
    if (typeof item !== 'string' || item.trim().length === 0 || item.length > 240) {
      return { outcome: 'PAUSE_OWNER', rationale: 'Invalid evidence item: must be non-empty string <= 240', stateUpdate: null };
    }
  }

  const validOutcomes = ['ACCEPT', 'REWORK_ONCE', 'REJECT', 'PAUSE_OWNER'];
  if (!validOutcomes.includes(outcome)) {
    return { outcome: 'PAUSE_OWNER', rationale: 'Invalid outcome: must be one of ACCEPT, REWORK_ONCE, REJECT, PAUSE_OWNER', stateUpdate: null };
  }

  // 2. Host Policy Inspection
  // Check requestedAction AND concatenated rationale/evidence
  const securityText = `${requestedAction} ${rationale} ${evidence.join(' ')}`;
  const violation = matchProtectedAction(securityText);
  if (violation) {
    return { 
      outcome: 'PAUSE_OWNER', 
      rationale: `Host policy violation: ${violation.label}`, 
      stateUpdate: null 
    };
  }

  // 3. Rework Allowance Logic
  if (outcome === 'REWORK_ONCE') {
    const reworkState = state.reworkByIdentity || {};
    if (reworkState[identity]) {
      return { outcome: 'PAUSE_OWNER', rationale: 'Rework allowance exhausted for this identity', stateUpdate: null };
    }
    
    const stateUpdate = {
      reworkByIdentity: {
        ...reworkState,
        [identity]: true,
      },
    };
    return { outcome: 'REWORK_ONCE', rationale: 'Rework granted', stateUpdate };
  }

  return { outcome, rationale, stateUpdate: null };
}

/**
 * Compatibility wrapper for older tests/docs.
 */
export function validateVerdict(verdictJson, state = {}) {
  const res = evaluateGate(verdictJson, state);
  return {
    verdict: res.outcome,
    reason: res.rationale,
    stateUpdate: res.stateUpdate,
  };
}
