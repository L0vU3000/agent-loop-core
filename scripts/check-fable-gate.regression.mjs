import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGate, applyStateUpdate } from '../orchestrator/fable-gate.mjs';

test('Outcome: VALID ACCEPT', () => {
  const verdict = {
    identity: 'agent-1',
    rationale: 'Safe documentation update',
    requestedAction: 'Update README.md typo',
    evidence: ['diff shows only whitespace correction'],
    outcome: 'ACCEPT'
  };
  const result = evaluateGate(verdict);
  assert.equal(result.outcome, 'ACCEPT');
});

test('Outcome: VALID REJECT', () => {
  const verdict = {
    identity: 'agent-1',
    rationale: 'Proposed action is logically unsound',
    requestedAction: 'Delete all config files',
    evidence: ['action deletes core settings'],
    outcome: 'REJECT'
  };
  const result = evaluateGate(verdict);
  assert.equal(result.outcome, 'REJECT');
});

test('Outcome: VALID PAUSE_OWNER (Fable decided)', () => {
  const verdict = {
    identity: 'agent-1',
    rationale: 'Too ambiguous to decide',
    requestedAction: 'Run mysterious script',
    evidence: ['script source is unknown'],
    outcome: 'PAUSE_OWNER'
  };
  const result = evaluateGate(verdict);
  assert.equal(result.outcome, 'PAUSE_OWNER');
});

test('Fail-Closed: Malformed JSON', () => {
  const result = evaluateGate('not json');
  assert.equal(result.outcome, 'PAUSE_OWNER');
  assert.match(result.rationale, /Malformed JSON/);
});

test('Fail-Closed: Invalid Types', () => {
  const invalidTypes = {
    identity: 123,
    rationale: 'Safe',
    requestedAction: 'Action',
    evidence: ['ok'],
    outcome: 'ACCEPT'
  };
  const result = evaluateGate(invalidTypes);
  assert.equal(result.outcome, 'PAUSE_OWNER');
  assert.match(result.rationale, /Invalid identity/);
});

test('Fail-Closed: Field Bounds (Identity too long)', () => {
  const tooLong = {
    identity: 'a'.repeat(161),
    rationale: 'Safe',
    requestedAction: 'Action',
    evidence: ['ok'],
    outcome: 'ACCEPT'
  };
  const result = evaluateGate(tooLong);
  assert.equal(result.outcome, 'PAUSE_OWNER');
});

test('Fail-Closed: Field Bounds (Rationale too long)', () => {
  const tooLong = {
    identity: 'agent-1',
    rationale: 'a'.repeat(601),
    requestedAction: 'Action',
    evidence: ['ok'],
    outcome: 'ACCEPT'
  };
  const result = evaluateGate(tooLong);
  assert.equal(result.outcome, 'PAUSE_OWNER');
});

test('Fail-Closed: Field Bounds (Evidence array size)', () => {
  const tooMany = {
    identity: 'agent-1',
    rationale: 'Safe',
    requestedAction: 'Action',
    evidence: Array(9).fill('ok'),
    outcome: 'ACCEPT'
  };
  const result = evaluateGate(tooMany);
  assert.equal(result.outcome, 'PAUSE_OWNER');
  assert.match(result.rationale, /Invalid evidence: must be array of 1-8 items/);
});

test('Fail-Closed: Field Bounds (Evidence item too long)', () => {
  const tooLongItem = {
    identity: 'agent-1',
    rationale: 'Safe',
    requestedAction: 'Action',
    evidence: ['a'.repeat(241)],
    outcome: 'ACCEPT'
  };
  const result = evaluateGate(tooLongItem);
  assert.equal(result.outcome, 'PAUSE_OWNER');
});

test('Policy: Production Deploy (Strict - no bypass)', () => {
  const cases = [
    'deploy to production',
    'production deploy',
    'vercel deploy',
    'deploy to production for internal review',
    'deploy prod'
  ];
  for (const action of cases) {
    const verdict = {
      identity: 'agent-1',
      rationale: 'Safe',
      requestedAction: action,
      evidence: ['ok'],
      outcome: 'ACCEPT'
    };
    const result = evaluateGate(verdict);
    assert.equal(result.outcome, 'PAUSE_OWNER', `Action "${action}" should be blocked`);
    assert.match(result.rationale, /Host policy violation: Production Deployment/);
  }
});

test('Policy: Git Sensitive', () => {
  const cases = ['merge into main', 'push to master', 'force push'];
  for (const action of cases) {
    const verdict = {
      identity: 'agent-1',
      rationale: 'Safe',
      requestedAction: action,
      evidence: ['ok'],
      outcome: 'ACCEPT'
    };
    const result = evaluateGate(verdict);
    assert.equal(result.outcome, 'PAUSE_OWNER');
    assert.match(result.rationale, /Host policy violation: Sensitive Git Operation/);
  }
});

test('Policy: Credentials', () => {
  const cases = ['Add API key', 'update secret', 'set password', 'credential leak'];
  for (const action of cases) {
    const verdict = {
      identity: 'agent-1',
      rationale: 'Safe',
      requestedAction: action,
      evidence: ['ok'],
      outcome: 'ACCEPT'
    };
    const result = evaluateGate(verdict);
    assert.equal(result.outcome, 'PAUSE_OWNER');
    assert.match(result.rationale, /Host policy violation: Credential Exposure/);
  }
});

test('Policy: Database Destructive', () => {
  const cases = ['run migration', 'drop table users', 'delete database', 'truncate table logs'];
  for (const action of cases) {
    const verdict = {
      identity: 'agent-1',
      rationale: 'Safe',
      requestedAction: action,
      evidence: ['ok'],
      outcome: 'ACCEPT'
    };
    const result = evaluateGate(verdict);
    assert.equal(result.outcome, 'PAUSE_OWNER');
    assert.match(result.rationale, /Host policy violation: Destructive Database Operation/);
  }
});

test('Policy: Auth/Session', () => {
  const cases = ['create account', 'create user', 'persistent session', 'auth token'];
  for (const action of cases) {
    const verdict = {
      identity: 'agent-1',
      rationale: 'Safe',
      requestedAction: action,
      evidence: ['ok'],
      outcome: 'ACCEPT'
    };
    const result = evaluateGate(verdict);
    assert.equal(result.outcome, 'PAUSE_OWNER');
    assert.match(result.rationale, /Host policy violation: Persistent Auth\/Session/);
  }
});

test('Policy: Public Publishing', () => {
  const cases = ['publish to public', 'update marketing site', 'edit privacy policy'];
  for (const action of cases) {
    const verdict = {
      identity: 'agent-1',
      rationale: 'Safe',
      requestedAction: action,
      evidence: ['ok'],
      outcome: 'ACCEPT'
    };
    const result = evaluateGate(verdict);
    assert.equal(result.outcome, 'PAUSE_OWNER');
    assert.match(result.rationale, /Host policy violation: Public Publishing/);
  }
});

test('Policy: Billing/Store', () => {
  const cases = ['update billing', 'app store submission', 'testflight upload'];
  for (const action of cases) {
    const verdict = {
      identity: 'agent-1',
      rationale: 'Safe',
      requestedAction: action,
      evidence: ['ok'],
      outcome: 'ACCEPT'
    };
    const result = evaluateGate(verdict);
    assert.equal(result.outcome, 'PAUSE_OWNER');
    assert.match(result.rationale, /Host policy violation: Billing\/Store Submission/);
  }
});

test('Policy: History Deletion', () => {
  const cases = ['rewrite history', 'git rebase -i', 'delete history'];
  for (const action of cases) {
    const verdict = {
      identity: 'agent-1',
      rationale: 'Safe',
      requestedAction: action,
      evidence: ['ok'],
      outcome: 'ACCEPT'
    };
    const result = evaluateGate(verdict);
    assert.equal(result.outcome, 'PAUSE_OWNER');
    assert.match(result.rationale, /Host policy violation: History Rewrite\/Deletion/);
  }
});

test('Policy: User Impact', () => {
  const cases = ['affect all users', 'broadcast to users', 'global notification'];
  for (const action of cases) {
    const verdict = {
      identity: 'agent-1',
      rationale: 'Safe',
      requestedAction: action,
      evidence: ['ok'],
      outcome: 'ACCEPT'
    };
    const result = evaluateGate(verdict);
    assert.equal(result.outcome, 'PAUSE_OWNER');
    assert.match(result.rationale, /Host policy violation: Real User Impact/);
  }
});

test('Policy: False Positive Avoidance', () => {
  const cases = [
    'review a local preview diff',
    'run internal unit tests',
    'inspect a test fixture',
    'update a local variable'
  ];
  for (const action of cases) {
    const verdict = {
      identity: 'agent-1',
      rationale: 'Safe',
      requestedAction: action,
      evidence: ['ok'],
      outcome: 'ACCEPT'
    };
    const result = evaluateGate(verdict);
    assert.equal(result.outcome, 'ACCEPT', `Action "${action}" should NOT be blocked`);
  }
});

test('Rework Logic: First granted, second blocked', () => {
  const verdict = {
    identity: 'agent-1',
    rationale: 'Minor fix needed',
    requestedAction: 'Update docs',
    evidence: ['typo found'],
    outcome: 'REWORK_ONCE'
  };
  
  // First attempt
  let state = {};
  let res1 = evaluateGate(verdict, state);
  assert.equal(res1.outcome, 'REWORK_ONCE');
  assert.ok(res1.stateUpdate.reworkByIdentity['agent-1']);
  
  // Apply state update
  state = applyStateUpdate(state, res1.stateUpdate);
  
  // Second attempt
  const res2 = evaluateGate(verdict, state);
  assert.equal(res2.outcome, 'PAUSE_OWNER');
  assert.match(res2.rationale, /Rework allowance exhausted/);
});

test('Rework Logic: Isolation by identity', () => {
  const verdict1 = {
    identity: 'agent-1',
    rationale: 'Fix 1',
    requestedAction: 'Action 1',
    evidence: ['ok'],
    outcome: 'REWORK_ONCE'
  };
  const verdict2 = {
    identity: 'agent-2',
    rationale: 'Fix 2',
    requestedAction: 'Action 2',
    evidence: ['ok'],
    outcome: 'REWORK_ONCE'
  };
  
  let state = {};
  const res1 = evaluateGate(verdict1, state);
  state = applyStateUpdate(state, res1.stateUpdate);
  
  const res2 = evaluateGate(verdict2, state);
  assert.equal(res2.outcome, 'REWORK_ONCE', 'Agent 2 should get rework even if Agent 1 used it');
});
