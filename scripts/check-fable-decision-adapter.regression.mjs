import assert from 'node:assert';
import { 
  validateBundle, 
  buildFableRequest, 
  requestFableDecision 
} from '../orchestrator/fable-decision-adapter.mjs';

async function runTests() {
  console.log('🚀 Starting Fable Decision Adapter Regression Tests...');

  const validBundle = {
    schemaVersion: '1.0.0',
    identity: 'feat-user-auth.md',
    category: 'building',
    type: 'implementation',
    objective: 'Implement JWT auth flow',
    changedFiles: ['src/auth.mjs', 'src/utils.mjs'],
    gateReferences: ['gate-123'],
    fablePromptPath: 'orchestrator/fable-decision-prompt.md',
    note: 'Auto Mode does NOT invoke Fable',
    rawBody: 'SHOULD BE IGNORED',
    secrets: 'SHOULD BE IGNORED'
  };

  // --- validateBundle tests ---
  console.log('Testing validateBundle...');
  
  try {
    const sanitized = validateBundle(validBundle);
    assert.strictEqual(sanitized.schemaVersion, '1.0.0');
    assert.strictEqual(sanitized.identity, 'feat-user-auth.md');
    assert.strictEqual(sanitized.category, 'building');
    assert.strictEqual(sanitized.type, 'implementation');
    assert.strictEqual(sanitized.objective, 'Implement JWT auth flow');
    assert.deepStrictEqual(sanitized.changedFiles, ['src/auth.mjs', 'src/utils.mjs']);
    assert.deepStrictEqual(sanitized.gateReferences, ['gate-123']);
    assert.strictEqual(sanitized.fablePromptPath, 'orchestrator/fable-decision-prompt.md');
    assert.strictEqual(sanitized.note, 'Auto Mode does NOT invoke Fable');
    assert.strictEqual(sanitized.rawBody, undefined, 'Unknown fields must be ignored');
    assert.strictEqual(sanitized.secrets, undefined, 'Unknown fields must be ignored');

    // Array cloning
    assert.notStrictEqual(sanitized.changedFiles, validBundle.changedFiles, 'changedFiles must be cloned');
    assert.notStrictEqual(sanitized.gateReferences, validBundle.gateReferences, 'gateReferences must be cloned');
    
    // Clone isolation: mutate sanitized and check original
    sanitized.changedFiles.push('mutated.mjs');
    sanitized.gateReferences.push('gate-mutated');
    assert.deepStrictEqual(validBundle.changedFiles, ['src/auth.mjs', 'src/utils.mjs'], 'Original changedFiles must remain unchanged');
    assert.deepStrictEqual(validBundle.gateReferences, ['gate-123'], 'Original gateReferences must remain unchanged');

    console.log(' ✅ Valid bundle sanitized correctly');
  } catch (e) {
    console.error(' ❌ Valid bundle failed:', e.message);
    process.exit(1);
  }

  const invalidBundles = [
    { label: 'Wrong schemaVersion', b: { ...validBundle, schemaVersion: '1.1.0' } },
    { label: 'Identity too long', b: { ...validBundle, identity: 'a'.repeat(161) + '.md' } },
    { label: 'Identity controls', b: { ...validBundle, identity: 'test\u0000.md' } },
    { label: 'Identity no .md', b: { ...validBundle, identity: 'feat-user-auth.txt' } },
    { label: 'Identity path traversal', b: { ...validBundle, identity: '../etc/passwd.md' } },
    { label: 'Identity forward slash', b: { ...validBundle, identity: 'dir/file.md' } },
    { label: 'Identity backslash', b: { ...validBundle, identity: 'dir\\file.md' } },
    { label: 'Identity dot', b: { ...validBundle, identity: '.md' } },
    { label: 'Identity dotdot', b: { ...validBundle, identity: '..md' } },
    { label: 'Invalid category', b: { ...validBundle, category: 'invalid' } },
    { label: 'Type empty', b: { ...validBundle, type: '' } },
    { label: 'Type too long', b: { ...validBundle, type: 't'.repeat(161) } },
    { label: 'Type controls', b: { ...validBundle, type: 'type\u0000' } },
    { label: 'Objective empty', b: { ...validBundle, objective: '' } },
    { label: 'Objective too long', b: { ...validBundle, objective: 'o'.repeat(241) } },
    { label: 'Objective controls', b: { ...validBundle, objective: 'obj\u0000' } },
    { label: 'changedFiles too many', b: { ...validBundle, changedFiles: Array(51).fill('file.mjs') } },
    { label: 'changedFiles too long', b: { ...validBundle, changedFiles: ['a'.repeat(241)] } },
    { label: 'changedFiles absolute path', b: { ...validBundle, changedFiles: ['/etc/passwd'] } },
    { label: 'changedFiles traversal', b: { ...validBundle, changedFiles: ['../../etc/passwd'] } },
    { label: 'changedFiles sensitive word', b: { ...validBundle, changedFiles: ['api_key.txt'] } },
    { label: 'gateReferences too many', b: { ...validBundle, gateReferences: Array(51).fill('gate-1') } },
    { label: 'gateReferences too long', b: { ...validBundle, gateReferences: ['a'.repeat(241)] } },
    { label: 'gateReferences controls', b: { ...validBundle, gateReferences: ['gate\u0000'] } },
    { label: 'Wrong prompt path', b: { ...validBundle, fablePromptPath: 'wrong/path.md' } },
    { label: 'Wrong note', b: { ...validBundle, note: 'Wrong note' } },
  ];

  for (const { label, b } of invalidBundles) {
    try {
      validateBundle(b);
      console.error(` ❌ ${label} should have thrown`);
      process.exit(1);
    } catch (e) {
      console.log(` ✅ ${label} failed as expected`);
    }
  }

  // Testing normalization (Trim)
  try {
    const trimmedBundle = { ...validBundle, type: '  implementation  ', objective: '  Implement JWT  ' };
    const sanitized = validateBundle(trimmedBundle);
    assert.strictEqual(sanitized.type, 'implementation', 'type should be trimmed');
    assert.strictEqual(sanitized.objective, 'Implement JWT', 'objective should be trimmed');
    console.log(' ✅ Normalization (trimming) works');
  } catch (e) {
    console.error(' ❌ Normalization failed:', e.message);
    process.exit(1);
  }

  // --- buildFableRequest tests ---
  console.log('Testing buildFableRequest...');
  try {
    const request = buildFableRequest(validBundle);
    assert.strictEqual(request.identity, 'feat-user-auth.md');
    assert.strictEqual(request.rawBody, undefined, 'Request must not leak rawBody');
    assert.strictEqual(request.secrets, undefined, 'Request must not leak secrets');
    console.log(' ✅ Request built without leaking raw data');
  } catch (e) {
    console.error(' ❌ buildFableRequest failed:', e.message);
    process.exit(1);
  }

  // --- requestFableDecision tests ---
  console.log('Testing requestFableDecision...');

  // 1. Exact call count and payload sanitization
  try {
    let callCount = 0;
    const mockInvoke = async (req) => {
      callCount++;
      assert.strictEqual(req.rawBody, undefined, 'Transport must receive sanitized request');
      assert.strictEqual(req.secrets, undefined, 'Transport must receive sanitized request');
      return { 
        identity: 'feat-user-auth.md', 
        rationale: 'Ok', 
        requestedAction: 'Merge', 
        evidence: ['Evidence 1'],
        outcome: 'ACCEPT' 
      };
    };
    const result = await requestFableDecision(validBundle, { invokeFable: mockInvoke });
    assert.strictEqual(result.outcome, 'ACCEPT');
    assert.strictEqual(callCount, 1, 'invokeFable must be called exactly once');
    console.log(' ✅ Call count and payload sanitization verified');
  } catch (e) {
    console.error(' ❌ Call count/payload test failed:', e.message);
    process.exit(1);
  }

  // 2. Invalid bundle should not call transport
  try {
    let callCount = 0;
    const mockInvoke = async () => { callCount++; return {}; };
    await requestFableDecision({ ...validBundle, schemaVersion: 'wrong' }, { invokeFable: mockInvoke }).catch(() => {});
    assert.strictEqual(callCount, 0, 'Transport must NOT be called if validation fails');
    console.log(' ✅ Pre-transport validation verified');
  } catch (e) {
    console.error(' ❌ Pre-transport validation test failed:', e.message);
    process.exit(1);
  }

  // 3. Verdict: ACCEPT with sensitive action -> PAUSE_OWNER
  try {
    const mockInvoke = async () => ({
      identity: 'feat-user-auth.md',
      rationale: 'Looks good',
      requestedAction: 'deploy to production',
      evidence: ['local gate evidence'],
      outcome: 'ACCEPT'
    });
    const result = await requestFableDecision(validBundle, { invokeFable: mockInvoke });
    assert.deepStrictEqual(result, { outcome: 'PAUSE_OWNER', rationale: 'Host policy violation: Production Deployment', stateUpdate: null }, 'ACCEPT with "deploy to production" must produce PAUSE_OWNER via host policy override');
    console.log(' ✅ Sensitive action verdict verified');
  } catch (e) {
    console.error(' ❌ Sensitive action test failed:', e.message);
    process.exit(1);
  }

  // 4. Verdict: REWORK_ONCE state and allowance
  try {
    const mockInvoke = async () => ({
      identity: 'feat-user-auth.md',
      rationale: 'Needs fix',
      requestedAction: 'Rework',
      evidence: ['Evidence 1'],
      outcome: 'REWORK_ONCE'
    });
    
    // Test valid grant
    const state = { existing: 'data' };
    const stateCopy = JSON.parse(JSON.stringify(state));
    const result = await requestFableDecision(validBundle, { invokeFable: mockInvoke, state });
    
    assert.strictEqual(result.outcome, 'REWORK_ONCE');
    assert.deepStrictEqual(result.stateUpdate.reworkByIdentity, { 'feat-user-auth.md': true }, 'Should mark identity as reworked');
    assert.deepStrictEqual(state, stateCopy, 'Adapter must not mutate provided state');
    
    // Test allowance exhausted
    const stateWithRework = { reworkByIdentity: { 'feat-user-auth.md': true } };
    const resultExhausted = await requestFableDecision(validBundle, { invokeFable: mockInvoke, state: stateWithRework });
    assert.strictEqual(resultExhausted.outcome, 'PAUSE_OWNER');
    assert.strictEqual(resultExhausted.rationale, 'Rework allowance exhausted for this identity');
    
    console.log(' ✅ REWORK_ONCE state and allowance verified');
  } catch (e) {
    console.error(' ❌ REWORK_ONCE state test failed:', e.message);
    process.exit(1);
  }

  // 5. Transport failure (rejection and throw)
  try {
    // Async rejection
    const mockInvokeReject = async () => { throw new Error('Network Error'); };
    const resultReject = await requestFableDecision(validBundle, { invokeFable: mockInvokeReject });
    assert.strictEqual(resultReject.outcome, 'PAUSE_OWNER');
    assert.strictEqual(resultReject.rationale, 'Fable transport failed');
    assert.strictEqual(resultReject.stateUpdate, null);
    
    // Synchronous throw
    const mockInvokeThrow = () => { throw new Error('Sync Error'); };
    const resultThrow = await requestFableDecision(validBundle, { invokeFable: mockInvokeThrow });
    assert.strictEqual(resultThrow.outcome, 'PAUSE_OWNER');
    assert.strictEqual(resultThrow.rationale, 'Fable transport failed');
    assert.strictEqual(resultThrow.stateUpdate, null);
    
    console.log(' ✅ Transport rejection and sync throw handled correctly');
  } catch (e) {
    console.error(' ❌ Transport failure test failed:', e.message);
    process.exit(1);
  }

  // 6. Malformed JSON response
  try {
    const mockInvokeMalformed = async () => 'NOT JSON';
    const result = await requestFableDecision(validBundle, { invokeFable: mockInvokeMalformed });
    assert.strictEqual(result.outcome, 'PAUSE_OWNER');
    assert.strictEqual(result.rationale, 'Malformed JSON');
    assert.strictEqual(result.stateUpdate, null);
    console.log(' ✅ Malformed JSON response handled correctly');
  } catch (e) {
    console.error(' ❌ Malformed JSON test failed:', e.message);
    process.exit(1);
  }

  console.log('\\n✨ All Fable Decision Adapter tests passed!');
}

runTests().catch(err => {
  console.error('💥 Uncaught error:', err);
  process.exit(1);
});
