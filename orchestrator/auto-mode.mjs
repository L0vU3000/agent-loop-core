#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planDispatch, claimItem, itemCategory } from './dispatch.mjs';
import { matchProtectedAction } from './fable-gate.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIRECTORY, '..');

const ALLOWED_CATEGORIES = new Set(['planning', 'review', 'maintenance', 'testing', 'building']);

/**
 * Milestone B: Deterministic Safe Admission
 * Inspects planDispatch routing order and returns at most ONE eligible work item.
 */
export function selectEligibleItem(root = DEFAULT_ROOT) {
  const { routable } = planDispatch(root);
  const skipped = [];
  let selected = null;

  for (const item of routable) {
    const { file, category } = item;
    const filePath = join(root, 'orchestrator', 'inbox', file);

    // 1. Delivery check (First priority)
    if (category === 'delivery') {
      skipped.push({ file, reason: 'delivery items are always paused' });
      continue;
    }

    // 2. Category check
    if (!ALLOWED_CATEGORIES.has(category)) {
      skipped.push({ file, reason: `category "${category}" is not eligible for Auto Mode` });
      continue;
    }

    // 3. Protected action check (read content)
    const content = readFileSync(filePath, 'utf8');
    const violation = matchProtectedAction(content);
    if (violation) {
      skipped.push({ file, reason: `policy violation: ${violation.label} (${violation.category})` });
      continue;
    }

    // First eligible item wins
    if (!selected) {
      selected = item;
    } else {
      // We continue scanning to populate skipped[] for all routable items
      skipped.push({ file, reason: 'higher priority item already selected' });
    }
  }

  return { selected, skipped };
}

/**
 * Atomically claims the selected item.
 */
export function claimEligibleItem(root = DEFAULT_ROOT) {
  const { selected } = selectEligibleItem(root);
  if (!selected) {
    throw new Error('no eligible work item found for Auto Mode');
  }
  return claimItem(root, selected.file);
}

/**
 * Builds a metadata-only evidence bundle for a future Fable call.
 */
export function buildEvidenceBundle(root = DEFAULT_ROOT, filename, { changedFiles = [], gateReferences = [] } = {}) {
  // Guard: must be a plain filename ending in .md with no control characters
  if (!filename || filename !== basename(filename) || !filename.endsWith('.md') || /[\x00-\x1F\x7F]/.test(filename)) {
    throw new Error('invalid filename');
  }

  const inboxDirectory = join(root, 'orchestrator', 'inbox');
  const claimedPath = join(inboxDirectory, 'in-progress', filename);

  if (!existsSync(claimedPath)) {
    throw new Error(`item ${filename} is not currently claimed in-progress`);
  }

  const content = readFileSync(claimedPath, 'utf8');
  const category = itemCategory(root, filename);
  
  // Objective derivation: strictly bounded objective from "Done =" line
  const doneMatch = content.match(/^Done\s*=\s*(.+)$/m);
  let objective = 'No explicit Done line';
  
  if (doneMatch) {
    const objectiveRaw = doneMatch[1].trim();
    if (objectiveRaw.length > 240) {
      throw new Error('objective exceeds max length of 240');
    }
    objective = objectiveRaw.replace(/\s+/g, ' ');
  }

  // Validation helpers
  const validateArray = (arr, label) => {
    if (!Array.isArray(arr)) throw new Error(`${label} must be an array`);
    if (arr.length > 50) throw new Error(`${label} exceeds max length of 50`);
    for (const s of arr) {
      if (typeof s !== 'string') throw new Error(`${label} item must be a string`);
      if (!s.trim()) throw new Error(`${label} item cannot be empty`);
      if (s.length > 240) throw new Error(`${label} item exceeds max length of 240`);
      if (s.includes('\x00')) throw new Error(`${label} item contains null byte`);
      if (/[\x00-\x1F\x7F]/.test(s)) throw new Error(`${label} item contains control characters`);
      if (s.startsWith('/') || s.includes(':\\\\') || s.includes('://')) throw new Error(`${label} item contains absolute path`);
      if (s.includes('..')) throw new Error(`${label} item contains directory traversal`);
      if (/(secret|token|password|api\s*key|credential|private\s*key)/i.test(s)) throw new Error(`${label} item contains sensitive content`);
    }
  };

  validateArray(changedFiles, 'changedFiles');
  validateArray(gateReferences, 'gateReferences');

  // We do not read arbitrary paths. we only use provided arrays.
  // Relative path to Fable prompt (mocked or derived from registry)
  // For Milestone B, we just provide the relative path based on the category/type.
  // In a real system, this would come from the registry.
  const fablePromptPath = `orchestrator/fable-decision-prompt.md`;

  return {
    schemaVersion: '1.0.0',
    identity: filename,
    category,
    type: content.match(/^type:\s*(.+)$/m)?.[1]?.trim() || 'unknown',
    objective,
    changedFiles,
    gateReferences,
    fablePromptPath,
    note: 'Auto Mode does NOT invoke Fable',
  };
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('auto-mode.mjs')) {
  const args = process.argv.slice(2);
  const rootOption = args.find(a => a.startsWith('--root='));
  const root = rootOption ? resolve(rootOption.slice('--root='.length)) : DEFAULT_ROOT;

  if (args.includes('--select')) {
    console.log(JSON.stringify(selectEligibleItem(root), null, 2));
  } else if (args.includes('--claim')) {
    try {
      console.log(JSON.stringify(claimEligibleItem(root), null, 2));
    } catch (e) {
      process.stderr.write(e.message + '\\n');
      process.exit(1);
    }
  } else if (args.includes('--bundle')) {
    const fileIdx = args.indexOf('--bundle');
    const file = args[fileIdx + 1];
    if (!file) {
      process.stderr.write('usage: --bundle <file> [--changed <f1,f2>] [--gates <g1,g2>],\\n');
      process.exit(1);
    }
    
    const changedArg = args.find(a => a.startsWith('--changed='))?.slice('--changed='.length) || '';
    const gatesArg = args.find(a => a.startsWith('--gates='))?.slice('--gates='.length) || '';
    
    try {
      const bundle = buildEvidenceBundle(root, file, {
        changedFiles: changedArg ? changedArg.split(',') : [],
        gateReferences: gatesArg ? gatesArg.split(',') : [],
      });
      console.log(JSON.stringify(bundle, null, 2));
    } catch (e) {
      process.stderr.write(e.message + '\\n');
      process.exit(1);
    }
  }
}
