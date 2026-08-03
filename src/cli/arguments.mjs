export const CLI_VERSION = '0.1.0'

export const CLI_HELP = `agent-loop ${CLI_VERSION}

Usage:
  agent-loop <command> [options]

Commands:
  doctor  Check whether a target repository is safe and ready
  run     Run one bounded bug-fix transaction
  recover Complete an evidence-persisted interrupted run

Global options:
  --help
  --version
`

export class CliUsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CliUsageError'
  }
}

const COMMON_VALUE_OPTIONS = new Map([
  ['--repo', 'repo'],
  ['--config', 'config'],
  ['--state-root', 'stateRoot'],
])

const COMMAND_VALUE_OPTIONS = {
  doctor: COMMON_VALUE_OPTIONS,
  run: new Map([...COMMON_VALUE_OPTIONS, ['--work-item', 'workItem']]),
  recover: new Map([
    ['--repo', 'repo'],
    ['--state-root', 'stateRoot'],
    ['--run-id', 'runId'],
  ]),
}

const COMMAND_FLAG_OPTIONS = {
  doctor: new Map([['--json', 'json']]),
  run: new Map([
    ['--json', 'json'],
    ['--acknowledge-unsandboxed-credential-access', 'acknowledgeUnsandboxedCredentialAccess'],
  ]),
  recover: new Map([['--json', 'json']]),
}

export function parseCliArguments(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { kind: 'help' }
  if (argv.length === 1 && argv[0] === '--version') return { kind: 'version' }
  if (argv.length === 0) throw new CliUsageError('a command is required')

  const command = argv[0]
  if (!['doctor', 'run', 'recover'].includes(command)) {
    throw new CliUsageError(`unknown command: ${command}`)
  }
  if (argv.slice(1).includes('--')) {
    throw new CliUsageError('argument separator -- is not supported')
  }

  const options = {}
  const seen = new Set()
  const valueOptions = COMMAND_VALUE_OPTIONS[command]
  const flagOptions = COMMAND_FLAG_OPTIONS[command]

  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index]
    if (seen.has(option)) throw new CliUsageError(`option ${option} may only be provided once`)

    const valueName = valueOptions.get(option)
    if (valueName) {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
        throw new CliUsageError(`option ${option} requires a value`)
      }
      options[valueName] = argv[index + 1]
      seen.add(option)
      index += 1
      continue
    }

    const flagName = flagOptions.get(option)
    if (flagName) {
      options[flagName] = true
      seen.add(option)
      continue
    }

    throw new CliUsageError(`unknown option for ${command}: ${option}`)
  }

  return { kind: 'command', command, options }
}
