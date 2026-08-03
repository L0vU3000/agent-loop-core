#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const RULES = [
  {
    path: 'README.md',
    requirements: [
      [/supported package-based transaction runtime/iu, 'name the supported package-based transaction runtime'],
      [/(?:legacy[\s\S]{0,120}degit|degit[\s\S]{0,120}legacy)/iu, 'mark the degit path as legacy'],
      [/npm pack --json/u, 'show local package creation'],
      [/(?:agent-loop|\$AGENT_LOOP) doctor/iu, 'show the doctor command'],
      [/(?:agent-loop|\$AGENT_LOOP) run/iu, 'show the run command'],
      [/(?:agent-loop|\$AGENT_LOOP) recover/iu, 'show the recovery command'],
    ],
  },
  {
    path: 'vault/architecture/distribution-model.md',
    requirements: [
      [/two distribution models/iu, 'separate the two distribution models'],
      [/supported[^\n]*package/iu, 'identify the package runtime as supported'],
      [/legacy[^\n]*copy-owned/iu, 'identify the copy-owned template as legacy'],
      [/not (?:currently )?published to npm/iu, 'avoid claiming npm publication'],
    ],
  },
  {
    path: 'vault/operations/installing-in-a-project.md',
    requirements: [
      [/npm pack --json/u, 'show npm pack from the core repository'],
      [/npm install[\s\S]{0,120}--prefix/u, 'install outside the target dependency tree'],
      [/\.agent-loop\/config\.json/u, 'locate target configuration'],
      [/(?:agent-loop|\$AGENT_LOOP) doctor[\s\S]{0,240}--json/iu, 'show the JSON doctor preflight'],
      [/credentials[^\n]*config/iu, 'forbid credentials in target configuration'],
    ],
  },
  {
    path: 'vault/operations/running-productized-transaction.md',
    requirements: [
      [/Target-owned configuration/u, 'document target-owned configuration'],
      [/External mutable state/u, 'document external mutable state'],
      [/(?:agent-loop|\$AGENT_LOOP) doctor[\s\S]{0,240}--json/iu, 'show the doctor command'],
      [/(?:agent-loop|\$AGENT_LOOP) run/iu, 'show the run command'],
      [/(?:agent-loop|\$AGENT_LOOP) recover[\s\S]{0,240}--run-id/iu, 'show evidence-persisted recovery by run ID'],
      [/never invokes Hermes/iu, 'state that deterministic recovery does not invoke a maker'],
      [/--acknowledge-unsandboxed-credential-access/u, 'require explicit unsandboxed access acknowledgment'],
      [/not an OS sandbox/iu, 'state the sandbox limitation'],
      [/no push, fetch, pull, clone, or merge/iu, 'state the remote and integration Git boundary'],
      [/## Upgrade/u, 'document upgrades'],
      [/## Uninstall/u, 'document uninstall behavior'],
      [/leaves[^\n]*\.agent-loop\/config\.json[^\n]*unchanged/iu, 'state that uninstall leaves target configuration unchanged'],
      [/external state[^\n]*separately/iu, 'state that external state is removed separately'],
    ],
  },
]

export function validateProductRuntimeDocs(root = ROOT) {
  const errors = []
  for (const rule of RULES) {
    const path = join(root, rule.path)
    if (!existsSync(path)) {
      errors.push(`${rule.path}: required documentation is missing`)
      continue
    }
    const source = readFileSync(path, 'utf8')
    for (const [pattern, description] of rule.requirements) {
      if (!pattern.test(source)) errors.push(`${rule.path}: must ${description}`)
    }
  }
  return errors
}

function runCli() {
  const errors = validateProductRuntimeDocs()
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`FAIL  ${error}\n`)
    process.stderr.write(`check-product-runtime-docs: FAILED (${errors.length} issue(s))\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write('check-product-runtime-docs: all good\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli()
