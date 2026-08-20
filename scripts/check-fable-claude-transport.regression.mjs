import assert from 'node:assert';
import { createFableClaudeTransport } from '../orchestrator/fable-claude-transport.mjs';
import { buildFableRequest } from '../orchestrator/fable-decision-adapter.mjs';

async function runTests() {
  console.log('🚀 Starting Fable Claude Transport Regression Tests...');

  const validBundle = {
    schemaVersion: '1.0.0',
    identity: 'test-spike.md',
    category: 'planning',
    type: 'Spike',
    objective: 'Validate transport logic',
    changedFiles: ['file1.js'],
    gateReferences: [],
    fablePromptPath: 'orchestrator/fable-decision-prompt.md',
    note: 'Auto Mode does NOT invoke Fable',
  };

  const validRequest = buildFableRequest(validBundle);

  // Test 1: Valid Request -> Exactly one call with locked config
  {
    console.log('Test 1: Valid Request -> Locked Config & Single Call');
    let callCount = 0;
    const mockRunner = async (prompt, config) => {
      callCount++;
      assert.deepStrictEqual(config, {
        model: 'fable',
        maxTurns: 1,
        allowedTools: '',
      }, 'Locked config mismatch');
      assert.ok(prompt.includes('JSON-only'), 'Prompt must require JSON-only');
      assert.ok(prompt.includes(JSON.stringify(validRequest)), 'Prompt must contain sanitized request JSON');
      return '{"outcome": "PROCEED", "rationale": "Valid", "stateUpdate": {}}';
    };

    const transport = createFableClaudeTransport({ runClaude: mockRunner });
    const response = await transport(validRequest);
    
    assert.strictEqual(callCount, 1, 'Runner must be called exactly once');
    assert.strictEqual(response, '{"outcome": "PROCEED", "rationale": "Valid", "stateUpdate": {}}', 'Response pass-through failed');
    console.log(' ✅ Passed');
  }

  // Test 2: Bypass Attempt (Invalid Category) -> Zero calls
  {
    console.log('Test 2: Bypass Attempt (Invalid Category) -> Zero Calls');
    let callCount = 0;
    const mockRunner = async () => { callCount++; };
    const transport = createFableClaudeTransport({ runClaude: mockRunner });
    
    const bypassRequest = {
      ...validRequest,
      category: 'malicious-category',
    };
    
    try {
      await transport(bypassRequest);
      assert.fail('Should have thrown for invalid category');
    } catch (e) {
      assert.ok(e.message.includes('Invalid category'), `Expected category error, got: ${e.message}`);
      assert.strictEqual(callCount, 0, 'Runner must not be called for invalid category');
    }
    console.log(' ✅ Passed');
  }

  // Test 3: Bypass Attempt (Secret in changedFiles) -> Zero calls
  {
    console.log('Test 3: Bypass Attempt (Secret in changedFiles) -> Zero Calls');
    let callCount = 0;
    const mockRunner = async () => { callCount++; };
    const transport = createFableClaudeTransport({ runClaude: mockRunner });
    
    const bypassRequest = {
      ...validRequest,
      changedFiles: ['api-key.txt'],
    };
    
    try {
      await transport(bypassRequest);
      assert.fail('Should have thrown for secret in changedFiles');
    } catch (e) {
      assert.ok(e.message.includes('sensitive information detected'), `Expected sensitive info error, got: ${e.message}`);
      assert.strictEqual(callCount, 0, 'Runner must not be called for sensitive files');
    }
    console.log(' ✅ Passed');
  }

  // Test 4: Sanitization Check (Extra Fields) -> One call, prompt sanitized
  {
    console.log('Test 4: Sanitization Check (Extra Fields) -> Prompt Sanitized');
    let callCount = 0;
    let capturedPrompt = '';
    const mockRunner = async (prompt) => { 
      callCount++; 
      capturedPrompt = prompt;
      return '{"outcome": "PROCEED"}';
    };
    const transport = createFableClaudeTransport({ runClaude: mockRunner });
    
    const requestWithExtras = {
      ...validRequest,
      rawBody: 'SECRET_INTERNAL_DATA',
      secrets: { key: '12345' },
    };
    
    await transport(requestWithExtras);
    
    assert.strictEqual(callCount, 1, 'Runner must be called for valid (but extra) request');
    assert.ok(!capturedPrompt.includes('SECRET_INTERNAL_DATA'), 'Prompt must NOT contain rawBody');
    assert.ok(!capturedPrompt.includes('12345'), 'Prompt must NOT contain secrets');
    assert.ok(capturedPrompt.includes(JSON.stringify(validRequest)), 'Prompt must contain only the sanitized request');
    console.log(' ✅ Passed');
  }

  // Test 5: Runner Throw -> Propagates
  {
    console.log('Test 5: Runner Throw -> Propagates');
    const mockRunner = async () => { throw new Error('Model Timeout'); };
    const transport = createFableClaudeTransport({ runClaude: mockRunner });
    
    try {
      await transport(validRequest);
      assert.fail('Should have propagated runner error');
    } catch (e) {
      assert.strictEqual(e.message, 'Model Timeout', 'Error propagation failed');
    }
    console.log(' ✅ Passed');
  }

  // Test 6: Capability Scan (No Side Effects)
  {
    console.log('Test 6: Capability Scan (No side-effect imports)');
    const fs = await import('node:fs');
    const code = fs.readFileSync('/home/hermes/development/projects/agent-loop-core-nightshift/orchestrator/fable-claude-transport.mjs', 'utf8');
    const forbidden = [
      'node:fs', 'node:child_process', 'node:os', 'node:net', 'node:http', 'node:https',
      'child_process', 'spawn', 'exec', 'fetch', 'claimItem', 'recordOutcome', 'cron', 'Workflow'
    ];
    for (const pattern of forbidden) {
      assert.ok(!code.includes(pattern), `Forbidden capability found in source: ${pattern}`);
    }
    console.log(' ✅ Passed');
  }

  console.log('\\n✨ All Fable Claude Transport tests passed!');
}

runTests().catch(err => {
  console.error('\\n❌ Test Suite Failed:');
  console.error(err);
  process.exit(1);
});
