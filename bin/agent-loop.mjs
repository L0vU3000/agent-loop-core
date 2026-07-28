#!/usr/bin/env node

import { isAbsolute } from 'node:path'

import {
  CLI_HELP,
  CLI_VERSION,
  CliUsageError,
  parseCliArguments,
} from '../src/cli/arguments.mjs'
import { doctorExitCode, formatDoctorReport, runDoctor } from '../src/cli/doctor.mjs'

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
