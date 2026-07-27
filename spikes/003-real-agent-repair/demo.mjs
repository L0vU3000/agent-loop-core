import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  copyControlPlaneFixture,
  createBrokenRepository,
  writeBugItem,
} from '../002-real-git-transaction/lib/fixture.mjs'
import { runRealGitTransaction } from '../002-real-git-transaction/lib/run-transaction.mjs'
import { createHermesMakerRuntime } from './lib/hermes-maker-runtime.mjs'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const AGENT_LOOP_ROOT = resolve(HERE, '../..')
const keep = process.argv.includes('--keep')
const demoRoot = mkdtempSync(join(tmpdir(), 'agent-loop-spike-003-live-'))

try {
  const controlPlaneRoot = join(demoRoot, 'agent-loop')
  const repositoryRoot = join(demoRoot, 'fixture-repository')
  const workspaceRoot = join(demoRoot, 'runtime-workspaces')
  const runId = `run-spike-003-${Date.now()}`

  copyControlPlaneFixture(AGENT_LOOP_ROOT, controlPlaneRoot)
  writeBugItem(controlPlaneRoot)
  createBrokenRepository(repositoryRoot)

  const result = await runRealGitTransaction({
    agentLoopRoot: controlPlaneRoot,
    repositoryRoot,
    workspaceRoot,
    runId,
    rubric: { sha256: '3'.repeat(64), passThreshold: 1 },
    makerExecutor: createHermesMakerRuntime({
      model: process.env.AGENT_LOOP_MAKER_MODEL,
      provider: process.env.AGENT_LOOP_MAKER_PROVIDER,
      acknowledgeUnsandboxedCredentialAccess: true,
    }),
  })

  process.stdout.write(`${JSON.stringify({
    demoRoot: keep ? demoRoot : null,
    run: result.run,
    preflight: result.preflight,
    maker: result.maker,
    verification: result.verification,
    objectiveGate: result.objectiveGate,
    record: result.record,
  }, null, 2)}\n`)
} finally {
  if (!keep) rmSync(demoRoot, { recursive: true, force: true })
}
