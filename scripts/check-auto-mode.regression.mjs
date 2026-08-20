#!/usr/bin/env node

import { writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, cpSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { selectEligibleItem, claimEligibleItem, buildEvidenceBundle } from '../orchestrator/auto-mode.mjs';

const SCRIPT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)));
const SOURCE_ROOT = resolve(SCRIPT_DIRECTORY, '..');

function copyRegistryFixture(destinationRoot) {
  mkdirSync(join(destinationRoot, 'pipelines'), { recursive: true });
  mkdirSync(join(destinationRoot, 'orchestrator'), { recursive: true });
  
  if (existsSync(join(SOURCE_ROOT, 'categories.md'))) {
    cpSync(join(SOURCE_ROOT, 'categories.md'), join(destinationRoot, 'categories.md'));
  }
  if (existsSync(join(SOURCE_ROOT, 'pipelines', 'README.md'))) {
    cpSync(join(SOURCE_ROOT, 'pipelines', 'README.md'), join(destinationRoot, 'pipelines', 'README.md'));
  }
  if (existsSync(join(SOURCE_ROOT, 'orchestrator', 'orchestrator.md'))) {
    cpSync(join(SOURCE_ROOT, 'orchestrator', 'orchestrator.md'), join(destinationRoot, 'orchestrator', 'orchestrator.md'));
  }
  
  if (existsSync(join(SOURCE_ROOT, 'pipelines'))) {
    for (const entry of readdirSync(join(SOURCE_ROOT, 'pipelines'))) {
      const sourceDirectory = join(SOURCE_ROOT, 'pipelines', entry);
      if (!statSync(sourceDirectory).isDirectory()) continue;
      const destinationDirectory = join(destinationRoot, 'pipelines', entry);
      mkdirSync(destinationDirectory, { recursive: true });
      const pipelineFile = join(sourceDirectory, 'pipeline.md');
      if (existsSync(pipelineFile)) {
        cpSync(pipelineFile, join(destinationDirectory, 'pipeline.md'));
      }
    }
  }
}

function createItem(root, name, category, type, priority = 'normal', content = 'Done = The goal is met') {
  const path = join(root, 'orchestrator', 'inbox', name);
  const body = `---
category: ${category}
type: ${type}
priority: ${priority}
---

${content}`;
  writeFileSync(path, body);
}

async function runTests() {
  console.log('Starting Auto Mode Milestone B Regression Tests...');
  
  const root = mkdtempSync(join(tmpdir(), 'auto-mode-test-'));

  try {
    copyRegistryFixture(root);
    const inboxDir = join(root, 'orchestrator', 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    mkdirSync(join(inboxDir, 'in-progress'), { recursive: true });

    // --- Test 1: Priority & Selection ---
    console.log('Testing Priority and Selection...');
    if (existsSync(inboxDir)) {
      for (const file of readdirSync(inboxDir)) {
        const p = join(inboxDir, file);
        if (statSync(p).isFile()) rmSync(p);
      }
    }
    createItem(root, 'high-safe.md', 'planning', 'research', 'high');
    createItem(root, 'low-safe.md', 'planning', 'research', 'normal');
    createItem(root, 'delivery-item.md', 'delivery', 'landing', 'high');
    
    const res1 = selectEligibleItem(root);
    assert.ok(res1.selected, 'Should have selected an item');
    assert.strictEqual(res1.selected.file, 'high-safe.md', 'Highest safe item should be selected');
    assert.strictEqual(res1.skipped.length, 2, 'Other items should be skipped');
    
    const lowSafeSkip = res1.skipped.find(s => s.file === 'low-safe.md');
    assert.ok(lowSafeSkip, 'Lower safe item should be in skipped');
    assert.strictEqual(lowSafeSkip.reason, 'higher priority item already selected', 'Reason should be priority');
    
    const deliverySkip = res1.skipped.find(s => s.file === 'delivery-item.md');
    assert.ok(deliverySkip, 'Delivery item should be skipped');
    assert.strictEqual(deliverySkip.reason, 'delivery items are always paused', 'Exact delivery reason required');
    console.log('✅ Priority and Selection passed');

    // --- Test 2: Protected Action vs Safe Selection ---
    console.log('Testing Protected Action... ');
    for (const file of readdirSync(inboxDir)) {
      const p = join(inboxDir, file);
      if (statSync(p).isFile()) rmSync(p);
    }
    createItem(root, 'unsafe-item.md', 'planning', 'research', 'high', 'Done = deploy to production (internal preview)');
    createItem(root, 'safe-item-2.md', 'planning', 'research', 'normal');
    const res2 = selectEligibleItem(root);
    assert.ok(res2.selected, 'Should have selected an item');
    assert.strictEqual(res2.selected.file, 'safe-item-2.md', 'Should skip protected action even with internal preview');
    console.log('✅ Protected Action passed');

    // --- Test 3: Claiming Items ---
    console.log('Testing claimEligibleItem...');
    for (const file of readdirSync(inboxDir)) {
      const p = join(inboxDir, file);
      if (statSync(p).isFile()) rmSync(p);
    }
    createItem(root, 'claim-1.md', 'planning', 'research', 'high');
    createItem(root, 'claim-2.md', 'planning', 'research', 'normal');
    
    const claimResult = claimEligibleItem(root);
    const claimedFile = claimResult.moved.split('/').pop();
    assert.strictEqual(claimedFile, 'claim-1.md', 'Should claim the high priority item');
    assert.ok(existsSync(join(inboxDir, 'in-progress', 'claim-1.md')), 'Item should be moved to in-progress');
    assert.ok(!existsSync(join(inboxDir, 'claim-1.md')), 'Item should be removed from inbox');
    assert.ok(existsSync(join(inboxDir, 'claim-2.md')), 'Next candidate should remain in inbox');
    console.log('✅ Claiming Items passed');

    // --- Test 4: Bundle Rejection (Unclaimed) ---
    console.log('Testing Bundle Rejection...');
    assert.throws(() => buildEvidenceBundle(root, 'unclaimed.md'), /is not currently claimed in-progress/);
    console.log('✅ Bundle Rejection passed');

    // --- Test 5: Filename Validation ---
    console.log('Testing Filename Validation...');
    const validItem = 'valid-bundle.md';
    createItem(root, validItem, 'planning', 'research');
    writeFileSync(join(inboxDir, 'in-progress', validItem), readFileSync(join(inboxDir, validItem)));
    rmSync(join(inboxDir, validItem));

    assert.throws(() => buildEvidenceBundle(root, '../../etc/passwd'), /invalid filename/);
    assert.throws(() => buildEvidenceBundle(root, 'test.txt'), /invalid filename/);
    
    // For control characters, we must ensure it fails the filename check BEFORE the claim check.
    // The current implementation checks filename first. Let's use a real control byte.
    const controlFile = 'test' + String.fromCharCode(0) + '.md';
    assert.throws(() => buildEvidenceBundle(root, controlFile), /invalid filename/);
    console.log('✅ Filename Validation passed');

    // --- Test 6: Evidence Validation ---
    console.log('Testing Evidence Validation...');
    const bundleValid = (files) => buildEvidenceBundle(root, validItem, { changedFiles: files });
    
    assert.throws(() => bundleValid(['file' + String.fromCharCode(0) + '.ts']), /contains null byte/);
    assert.throws(() => bundleValid(['../secret.ts']), /contains directory traversal/);
    assert.throws(() => bundleValid(['']), /cannot be empty/);
    assert.throws(() => bundleValid(['/abs/path/file.ts']), /contains absolute path/);
    assert.throws(() => bundleValid(['https://remote.com/file.ts']), /contains absolute path/);
    
    const sensitive = ['secret', 'token', 'password', 'api key', 'credential', 'private key'];
    for (const s of sensitive) {
      assert.throws(() => bundleValid([`test-${s}.ts`]), /contains sensitive content/);
    }
    
    const safeBundle = bundleValid(['src/index.ts']);
    assert.deepStrictEqual(safeBundle.changedFiles, ['src/index.ts']);
    console.log('✅ Evidence Validation passed');

    // --- Test 7: Objective Normalization & Bounds ---
    console.log('Testing Objective...');
    const objItem = 'obj-test.md';
    createItem(root, objItem, 'planning', 'research');
    const objPath = join(inboxDir, 'in-progress', objItem);
    writeFileSync(objPath, `---
category: planning
type: research
---

Done =  This is   a   test  objective  `);
    
    const bundleObj = buildEvidenceBundle(root, objItem);
    assert.strictEqual(bundleObj.objective, 'This is a test objective', 'Should normalize whitespace');
    
    writeFileSync(objPath, `Done = ${'A'.repeat(241)}`);
    assert.throws(() => buildEvidenceBundle(root, objItem), /objective exceeds max length of 240/);
    
    writeFileSync(objPath, 'No objective here');
    assert.strictEqual(buildEvidenceBundle(root, objItem).objective, 'No explicit Done line');
    console.log('✅ Objective passed');

    // --- Test 8: Bundle Invariants (No Raw Body) ---
    console.log('Testing Bundle Invariants...');
    const bodySecret = 'SECRET_BODY_CONTENT';
    writeFileSync(objPath, `Done = Goal

${bodySecret}`);
    const bundleNoBody = buildEvidenceBundle(root, objItem);
    assert.ok(!JSON.stringify(bundleNoBody).includes(bodySecret), 'Bundle must not contain raw body');
    console.log('✅ Bundle Invariants passed');

    // --- Test 9: Code-string Invariants ---
    console.log('Testing Code Invariants...');
    const code = readFileSync(join(SOURCE_ROOT, 'orchestrator', 'auto-mode.mjs'), 'utf8');
    const forbidden = ['recordOutcome', 'evaluateGate', 'runFastGates', 'child_process', 'fetch(', 'cron', 'Workflow('];
    for (const term of forbidden) {
      assert.ok(!code.includes(term), `Forbidden term \\\"${term}\\\" found in auto-mode.mjs`);
    }
    console.log('✅ Code Invariants passed');

  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log('\\nALL AUTO-MODE REGRESSION TESTS PASSED');
}

runTests().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
