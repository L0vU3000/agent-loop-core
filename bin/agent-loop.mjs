#!/usr/bin/env node

import { isAbsolute } from 'node:path'

import {
  CLI_HELP,
  CLI_VERSION,
  CliUsageError,
  parseCliArguments,
} from '../src/cli/arguments.mjs'
import { doctorExitCode, formatDoctorReport, runDoctor } from '../src/cli/doctor.mjs'
import { runAgentLoopRecover } from '../src/cli/recover.mjs'
import { runAgentLoopRun } from '../src/cli/run.mjs'

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function writeError(message) {
  process.stderr.write(`error: ${message}\nTry 'agent-loop --help' for usage.\n`)
}

try {
  const parsed = parseCliArguments(process.argv.slice(2))
  if (parsed.kind === 'help') {
    process.stdout.write(CLI_HELP)
  } else if (parsed.kind === 'version') {
    process.stdout.write(`${CLI_VERSION}\n`)
  } else if (parsed.command === 'doctor') {
    if (parsed.options.repo === undefined) {
      throw new CliUsageError('option --repo is required for doctor')
    }
    if (parsed.options.stateRoot !== undefined && !isAbsolute(parsed.options.stateRoot)) {
      throw new CliUsageError('option --state-root must be an absolute path')
    }
    const report = runDoctor(parsed.options)
    process.stdout.write(parsed.options.json
      ? `${JSON.stringify(report)}\n`
      : formatDoctorReport(report))
    process.exitCode = doctorExitCode(report)
  } else if (parsed.command === 'run') {
    if (parsed.options.repo === undefined) {
      throw new CliUsageError('option --repo is required for run')
    }
    if (parsed.options.workItem === undefined) {
      throw new CliUsageError('option --work-item is required for run')
    }
    if (parsed.options.acknowledgeUnsandboxedCredentialAccess !== true) {
      throw new CliUsageError('option --acknowledge-unsandboxed-credential-access is required for run')
    }
    if (parsed.options.stateRoot !== undefined && !isAbsolute(parsed.options.stateRoot)) {
      throw new CliUsageError('option --state-root must be an absolute path')
    }
    const report = await runAgentLoopRun(parsed.options)
    process.stdout.write(parsed.options.json
      ? `${JSON.stringify(report.json)}\n`
      : report.human)
    process.exitCode = report.exitCode
  } else if (parsed.command === 'recover') {
    if (parsed.options.repo === undefined) {
      throw new CliUsageError('option --repo is required for recover')
    }
    if (parsed.options.runId === undefined) {
      throw new CliUsageError('option --run-id is required for recover')
    }
    if (!RUN_ID.test(parsed.options.runId)) {
      throw new CliUsageError('option --run-id must be a safe identifier')
    }
    if (parsed.options.stateRoot !== undefined && !isAbsolute(parsed.options.stateRoot)) {
      throw new CliUsageError('option --state-root must be an absolute path')
    }
    const report = runAgentLoopRecover(parsed.options)
    process.stdout.write(parsed.options.json
      ? `${JSON.stringify(report.json)}\n`
      : report.human)
    process.exitCode = report.exitCode
  } else {
    writeError(`${parsed.command} is not implemented yet`)
    process.exitCode = 3
  }
} catch (error) {
  if (error instanceof CliUsageError) {
    writeError(error.message)
    process.exitCode = 2
  } else {
    writeError('internal failure')
    process.exitCode = 3
  }
}
