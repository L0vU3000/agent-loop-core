import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { runDoctor } from '../src/cli/doctor.mjs'
import { runCommand } from '../src/runtime/command.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = resolve(ROOT, 'bin', 'agent-loop.mjs')

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-loop-doctor-test-'))
  try {
    return run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function runGit(repositoryPath, args) {
  const result = spawnSync('/usr/bin/git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8',
    env: { HOME: repositoryPath, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function createReadyFixture(directory) {
  const repositoryPath = join(directory, 'repository')
  const binPath = join(directory, 'bin')
  const stateRoot = join(directory, 'state')
  mkdirSync(join(repositoryPath, '.agent-loop'), { recursive: true })
  mkdirSync(binPath)
  writeFileSync(join(repositoryPath, 'README.md'), '# fixture\n')
  writeFileSync(join(repositoryPath, '.agent-loop', 'config.json'), JSON.stringify({
    schemaVersion: 1,
    pipeline: 'bug-fix',
    test: { executable: 'node', args: ['--test'] },
    allowedPaths: ['README.md'],
    maker: {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      timeoutMs: 300000,
      maxTurns: 40,
    },
  }))
  runGit(repositoryPath, ['init', '--quiet'])
  runGit(repositoryPath, ['add', '.'])
  runGit(repositoryPath, [
    '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '-m', 'fixture',
  ])

  const hermesPath = join(binPath, 'hermes')
  writeFileSync(hermesPath, `#!/bin/sh
printf '%s\\n' "$*" >> "$0.log"
printf '%s\\n' 'Hermes Agent test fixture'
`)
  chmodSync(hermesPath, 0o755)

  return { repositoryPath, binPath, stateRoot }
}

test('missing target is an unhealthy readiness result rather than a configuration usage error', () => {
  withTemporaryDirectory((directory) => {
    const missingTarget = join(directory, 'does-not-exist')
    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', missingTarget,
      '--state-root', join(directory, 'state'),
      '--json',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { HOME: directory, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.healthy, false)
    assert.equal(report.checks.find(({ id }) => id === 'git.repository').status, 'fail')
    assert.match(
      report.checks.find(({ id }) => id === 'git.repository').message,
      /must exist and be a Git repository/,
    )
  })
})

test('doctor rejects a HEAD that resolves to a non-commit object', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath, stateRoot } = createReadyFixture(directory)
    const blobPath = join(directory, 'blob.txt')
    writeFileSync(blobPath, 'not a commit\n')
    const blob = runGit(repositoryPath, ['hash-object', '-w', blobPath])
    writeFileSync(join(repositoryPath, '.git', 'HEAD'), `${blob}\n`)

    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', stateRoot,
      '--json',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { HOME: directory, PATH: `${binPath}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.checks.find(({ id }) => id === 'git.head').status, 'fail')
  })
})

test('doctor rejects missing repo and relative state-root arguments with exit two', () => {
  const missingRepo = spawnSync(process.execPath, [CLI, 'doctor', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.equal(missingRepo.status, 2)
  assert.match(missingRepo.stderr, /option --repo is required for doctor/)

  withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath } = createReadyFixture(directory)
    const relativeState = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', 'relative/state',
      '--json',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { HOME: directory, PATH: `${binPath}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    })

    assert.equal(relativeState.status, 2, `${relativeState.stderr}\n${relativeState.stdout}`)
    assert.match(relativeState.stderr, /option --state-root must be an absolute path/)
    assert.equal(relativeState.stdout, '')
    assert.equal(runGit(repositoryPath, ['status', '--porcelain']), '')
  })
})

test('invalid target configuration exits two with a redacted stable diagnostic', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath, stateRoot } = createReadyFixture(directory)
    const configPath = join(repositoryPath, '.agent-loop', 'config.json')
    writeFileSync(configPath, JSON.stringify({ apiKey: 'credential-must-not-appear' }))
    runGit(repositoryPath, ['add', '.agent-loop/config.json'])
    runGit(repositoryPath, [
      '-c', 'user.name=Fixture',
      '-c', 'user.email=fixture@example.invalid',
      'commit', '--quiet', '-m', 'invalid config fixture',
    ])

    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', stateRoot,
      '--json',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { HOME: directory, PATH: `${binPath}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`)
    assert.equal(result.stderr, '')
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /credential-must-not-appear|apiKey/)
    const report = JSON.parse(result.stdout)
    assert.equal(report.healthy, false)
    assert.deepEqual(
      report.checks.find(({ id }) => id === 'config.valid'),
      { id: 'config.valid', status: 'fail', message: 'Configuration is invalid.' },
    )
    assert.equal(runGit(repositoryPath, ['status', '--porcelain']), '')
  })
})

test('required readiness failures exit one and human output states the unsandboxed limitation', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath } = createReadyFixture(directory)
    rmSync(join(binPath, 'hermes'))
    writeFileSync(join(repositoryPath, 'dirty.txt'), 'must remain untouched\n')
    const statusBefore = runGit(repositoryPath, ['status', '--porcelain'])

    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', join(repositoryPath, 'unsafe-state'),
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { HOME: directory, PATH: `${binPath}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`)
    assert.equal(result.stderr, '')
    assert.match(result.stdout, /\[FAIL\] git\.clean: Target checkout must be clean\./)
    assert.match(result.stdout, /\[FAIL\] state\.disjoint: External state root is unsafe/)
    assert.match(result.stdout, /\[FAIL\] hermes\.executable: Hermes must be installed/)
    assert.match(
      result.stdout,
      /\[WARN\] sandbox\.deferred:.*not an OS sandbox.*disposable repositories.*non-production credentials/i,
    )
    assert.equal(runGit(repositoryPath, ['status', '--porcelain']), statusBefore)
    assert.equal(readFileSync(join(repositoryPath, 'dirty.txt'), 'utf8'), 'must remain untouched\n')
  })
})

test('doctor removes relative PATH entries before a Hermes shebang resolves its interpreter', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, stateRoot } = createReadyFixture(directory)
    const trustedBin = join(directory, 'trusted-bin')
    const relativeBin = join(directory, 'relative-bin')
    const markerPath = join(directory, 'spoofed-interpreter-ran')
    mkdirSync(trustedBin)
    mkdirSync(relativeBin)
    writeFileSync(join(trustedBin, 'hermes'), `#!/usr/bin/env node\nprocess.stdout.write('Hermes fixture\\n')\n`)
    chmodSync(join(trustedBin, 'hermes'), 0o755)
    writeFileSync(join(relativeBin, 'node'), `#!/bin/sh\nprintf ran > "${markerPath}"\nexit 0\n`)
    chmodSync(join(relativeBin, 'node'), 0o755)

    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', stateRoot,
      '--json',
    ], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        HOME: directory,
        PATH: `${trustedBin}:relative-bin:${dirname(process.execPath)}:/usr/bin:/bin`,
        LANG: 'C.UTF-8',
      },
    })

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.checks.find(({ id }) => id === 'hermes.executable').status, 'pass')
    assert.equal(existsSync(markerPath), false)
    assert.equal(runGit(repositoryPath, ['status', '--porcelain']), '')
  })
})

test('doctor excludes absolute target-controlled PATH entries from Hermes shebang resolution', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, stateRoot } = createReadyFixture(directory)
    const trustedBin = join(directory, 'trusted-bin')
    const targetBin = join(repositoryPath, 'tools')
    const marker = join(directory, 'target-interpreter-ran')
    mkdirSync(trustedBin)
    mkdirSync(targetBin)
    writeFileSync(
      join(trustedBin, 'hermes'),
      '#!/usr/bin/env node\nprocess.stdout.write("Hermes Agent trusted fixture\\n")\n',
      { mode: 0o755 },
    )
    writeFileSync(
      join(targetBin, 'node'),
      `#!/bin/sh\nprintf target-controlled > ${JSON.stringify(marker)}\nexit 0\n`,
      { mode: 0o755 },
    )
    runGit(repositoryPath, ['add', 'tools/node'])
    runGit(repositoryPath, [
      '-c', 'user.name=Doctor Test',
      '-c', 'user.email=doctor@example.invalid',
      'commit', '-m', 'add target-controlled interpreter',
    ])

    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', stateRoot,
      '--json',
    ], {
      cwd: repositoryPath,
      encoding: 'utf8',
      env: {
        HOME: directory,
        PATH: `${trustedBin}:${targetBin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        LANG: 'C.UTF-8',
      },
    })

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
    assert.equal(existsSync(marker), false)
  })
})

test('doctor rejects a Hermes executable symlinked into the target repository', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, stateRoot } = createReadyFixture(directory)
    const trustedBin = join(directory, 'trusted-bin')
    const targetHermes = join(repositoryPath, 'target-hermes')
    const marker = join(directory, 'target-hermes-ran')
    mkdirSync(trustedBin)
    writeFileSync(
      targetHermes,
      `#!/bin/sh\nprintf target-controlled > ${JSON.stringify(marker)}\nexit 0\n`,
      { mode: 0o755 },
    )
    symlinkSync(targetHermes, join(trustedBin, 'hermes'))
    runGit(repositoryPath, ['add', 'target-hermes'])
    runGit(repositoryPath, [
      '-c', 'user.name=Doctor Test',
      '-c', 'user.email=doctor@example.invalid',
      'commit', '-m', 'add target-controlled Hermes',
    ])

    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', stateRoot,
      '--json',
    ], {
      cwd: repositoryPath,
      encoding: 'utf8',
      env: { HOME: directory, PATH: `${trustedBin}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.checks.find(({ id }) => id === 'hermes.executable').status, 'fail')
    assert.equal(existsSync(marker), false)
  })
})

test('doctor skips Hermes when protected Git metadata roots cannot be established', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath } = createReadyFixture(directory)
    const linkedPath = join(directory, 'linked')
    runGit(repositoryPath, ['worktree', 'add', '-b', 'doctor-linked-test', linkedPath])

    const gitMetadataBin = join(repositoryPath, '.git', 'doctor-bin')
    const marker = join(directory, 'git-metadata-hermes-ran')
    mkdirSync(gitMetadataBin)
    writeFileSync(
      join(gitMetadataBin, 'hermes'),
      `#!/bin/sh\nprintf git-metadata > ${JSON.stringify(marker)}\nexit 0\n`,
      { mode: 0o755 },
    )

    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', linkedPath,
      '--state-root', join(linkedPath, '.agent-loop-state'),
      '--json',
    ], {
      cwd: linkedPath,
      encoding: 'utf8',
      env: { HOME: directory, PATH: `${gitMetadataBin}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.checks.find(({ id }) => id === 'state.disjoint').status, 'fail')
    assert.equal(report.checks.find(({ id }) => id === 'hermes.executable').status, 'fail')
    assert.equal(existsSync(marker), false)
  })
})

test('doctor disables repository-controlled fsmonitor execution while checking cleanliness', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath, stateRoot } = createReadyFixture(directory)
    const fsmonitorPath = join(directory, 'malicious-fsmonitor')
    const markerPath = join(directory, 'fsmonitor-ran')
    writeFileSync(fsmonitorPath, `#!/bin/sh\nprintf '%s\\n' ran >> "${markerPath}"\nexit 0\n`)
    chmodSync(fsmonitorPath, 0o755)
    runGit(repositoryPath, ['config', 'core.fsmonitor', fsmonitorPath])

    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', stateRoot,
      '--json',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { HOME: directory, PATH: `${binPath}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
    assert.equal(existsSync(markerPath), false, 'doctor must not execute repository-configured helpers')
    runGit(repositoryPath, ['config', '--unset', 'core.fsmonitor'])
    assert.equal(runGit(repositoryPath, ['status', '--porcelain']), '')
  })
})

test('doctor reports unsupported Node, Git, and Hermes command failures through injected execution', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, stateRoot } = createReadyFixture(directory)
    const calls = []
    const failedCommand = Object.freeze({
      status: 127,
      signal: null,
      errorCode: 'ENOENT',
      stdout: '',
      stderr: 'sensitive raw command failure',
    })

    const report = runDoctor(
      { repo: repositoryPath, stateRoot },
      {
        env: { HOME: directory, PATH: '/usr/bin:/bin', SECRET_TOKEN: 'must-not-appear' },
        nodeVersion: '17.9.0',
        locateExecutable() {
          return '/fixture/bin/hermes'
        },
        execute(executable, args) {
          calls.push([executable, args])
          return failedCommand
        },
      },
    )

    assert.equal(report.healthy, false)
    for (const id of ['node.version', 'git.executable', 'git.repository', 'hermes.executable']) {
      assert.equal(report.checks.find((item) => item.id === id).status, 'fail')
    }
    assert.deepEqual(calls, [
      ['/usr/bin/git', [
        '--no-optional-locks',
        '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=/dev/null',
        '--version',
      ]],
      ['/usr/bin/git', [
        '--no-optional-locks',
        '-c', 'core.fsmonitor=false',
        '-c', 'core.hooksPath=/dev/null',
        '-C', repositoryPath,
        'rev-parse', '--show-toplevel',
      ]],
      ['/fixture/bin/hermes', ['--version']],
    ])
    assert.doesNotMatch(JSON.stringify(report), /sensitive raw command failure|must-not-appear/)
  })
})

test('command execution uses an environment allowlist and never invokes a shell', () => {
  withTemporaryDirectory((directory) => {
    const probePath = join(directory, 'probe.mjs')
    const injectedPath = join(directory, 'shell-injection-marker')
    writeFileSync(probePath, `process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), env: process.env }))\n`)
    const shellLikeArgument = `; touch ${injectedPath}`

    const result = runCommand(process.execPath, [probePath, shellLikeArgument], {
      cwd: directory,
      env: {
        HOME: directory,
        HERMES_HOME: join(directory, 'hermes-home'),
        PATH: '/usr/bin:/bin',
        LANG: 'C.UTF-8',
        API_KEY: 'must-not-be-forwarded',
        SECRET_TOKEN: 'must-not-be-forwarded',
      },
    })

    assert.equal(result.status, 0, result.stderr)
    const observed = JSON.parse(result.stdout)
    assert.deepEqual(observed.argv, [shellLikeArgument])
    assert.equal(observed.env.HOME, directory)
    assert.equal(observed.env.HERMES_HOME, join(directory, 'hermes-home'))
    assert.equal(observed.env.API_KEY, undefined)
    assert.equal(observed.env.SECRET_TOKEN, undefined)
    assert.equal(observed.env.SHELL, undefined)
    assert.equal(existsSync(injectedPath), false)
  })
})

test('an unwritable prospective state root makes doctor unhealthy without touching the target', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath } = createReadyFixture(directory)
    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', `/proc/agent-loop-doctor-${process.pid}`,
      '--json',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { HOME: directory, PATH: `${binPath}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.checks.find(({ id }) => id === 'state.disjoint').status, 'pass')
    assert.equal(report.checks.find(({ id }) => id === 'state.writable').status, 'fail')
    assert.equal(runGit(repositoryPath, ['status', '--porcelain']), '')
  })
})

test('an uncreatable prospective state path is not reported writable', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath } = createReadyFixture(directory)
    const impossibleStateRoot = join(directory, 'x'.repeat(300), 'state')
    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', impossibleStateRoot,
      '--json',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { HOME: directory, PATH: `${binPath}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 1, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.checks.find(({ id }) => id === 'state.disjoint').status, 'pass')
    assert.equal(report.checks.find(({ id }) => id === 'state.writable').status, 'fail')
    assert.equal(runGit(repositoryPath, ['status', '--porcelain']), '')
  })
})

test('doctor resolves a repository subdirectory to the canonical top-level configuration', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath, stateRoot } = createReadyFixture(directory)
    const nestedPath = join(repositoryPath, 'nested', 'directory')
    mkdirSync(nestedPath, { recursive: true })

    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', nestedPath,
      '--state-root', stateRoot,
      '--json',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { HOME: directory, PATH: `${binPath}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    })

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.healthy, true)
    assert.equal(report.checks.find(({ id }) => id === 'config.valid').status, 'pass')
    assert.equal(runGit(repositoryPath, ['status', '--porcelain']), '')
  })
})

test('doctor reports a stable healthy JSON preflight without invoking a provider or mutating the target', () => {
  withTemporaryDirectory((directory) => {
    const { repositoryPath, binPath, stateRoot } = createReadyFixture(directory)
    const configPath = join(repositoryPath, '.agent-loop', 'config.json')
    const configBefore = readFileSync(configPath, 'utf8')
    const headBefore = runGit(repositoryPath, ['rev-parse', 'HEAD'])

    const result = spawnSync(process.execPath, [
      CLI,
      'doctor',
      '--repo', repositoryPath,
      '--state-root', stateRoot,
      '--json',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        HOME: directory,
        PATH: `${binPath}:/usr/bin:/bin`,
        LANG: 'C.UTF-8',
      },
    })

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.schemaVersion, 1)
    assert.equal(report.healthy, true)
    assert.deepEqual(report.checks.map(({ id }) => id), [
      'node.version',
      'git.executable',
      'git.repository',
      'git.head',
      'git.clean',
      'config.valid',
      'state.disjoint',
      'state.writable',
      'hermes.executable',
      'sandbox.deferred',
    ])
    assert.deepEqual(
      report.checks.map(({ status }) => status),
      ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'warning'],
    )
    assert.match(
      report.checks.at(-1).message,
      /not an OS sandbox.*disposable repositories.*non-production credentials/i,
    )
    assert.equal(readFileSync(join(binPath, 'hermes.log'), 'utf8'), '--version\n')
    assert.equal(existsSync(stateRoot), false)
    assert.equal(readFileSync(configPath, 'utf8'), configBefore)
    assert.equal(runGit(repositoryPath, ['rev-parse', 'HEAD']), headBefore)
    assert.equal(runGit(repositoryPath, ['status', '--porcelain']), '')
  })
})
