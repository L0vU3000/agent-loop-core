#!/usr/bin/env node

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  copyControlPlaneFixture,
  createBrokenRepository,
  writeBugItem,
} from './lib/fixture.mjs'
import { runRealGitTransaction } from './lib/run-transaction.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const agentLoopSourceRoot = resolve(here, '../..')
const root = mkdtempSync(join(tmpdir(), 'agent-loop-spike-002-demo-'))
const agentLoopRoot = join(root, 'agent-loop')
const repositoryRoot = join(root, 'fixture-repository')
const workspaceRoot = join(root, 'runtime-workspaces')

copyControlPlaneFixture(agentLoopSourceRoot, agentLoopRoot)
writeBugItem(agentLoopRoot)
createBrokenRepository(repositoryRoot)

const result = await runRealGitTransaction({
  agentLoopRoot,
  repositoryRoot,
  workspaceRoot,
  runId: `run-spike-002-${Date.now()}`,
  rubric: {
    sha256: 'a'.repeat(64),
    passThreshold: 1,
  },
})

process.stdout.write(`${JSON.stringify({
  demoRoot: root,
  run: result.run,
  claim: result.claim,
  preflight: result.preflight,
  maker: result.maker,
  verification: result.verification,
  objectiveGate: result.objectiveGate,
  record: result.record,
}, null, 2)}\n`)
