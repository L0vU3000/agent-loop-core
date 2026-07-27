#!/usr/bin/env node

import {
  CLI_HELP,
  CLI_VERSION,
  CliUsageError,
  parseCliArguments,
} from '../src/cli/arguments.mjs'

function writeError(message) {
  process.stderr.write(`error: ${message}\nTry 'agent-loop --help' for usage.\n`)
}

try {
  const parsed = parseCliArguments(process.argv.slice(2))
  if (parsed.kind === 'help') {
    process.stdout.write(CLI_HELP)
  } else if (parsed.kind === 'version') {
    process.stdout.write(`${CLI_VERSION}\n`)
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
