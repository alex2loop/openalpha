import type { Subprocess } from 'bun'
import { closeSync, openSync } from 'node:fs'
import { join } from 'node:path'

import type { CliApp } from '@/cli/types'
import { type Command, createCommand } from '@/cli/command'
import {
  clearMalformedPidFile,
  inspectDaemon,
  liveDaemonPid,
  removePidFile,
  requestDaemonStop,
  watchStopRequest,
  writePidFile,
} from '@/cli/daemon-guard'
import { getEnv } from '@/cli/env'
import { terminalErrorMessage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA, CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, type ParsedArgs } from '@/cli/parsing/args'
import { resolveSelfCommand } from '@/cli/services'
import { hint, info, style, success } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { formatErrForLog } from '@/core/security/credentials'
import { PRIVATE_FILE_MODE } from '@/core/security/private-files'
import { isPlainRecord } from '@/core/utils/collections'
import { sleep } from '@/core/utils/time'
import { t } from '@/i18n'

const PID_POLL_MS = 100
// Outlasts the daemon's own shutdown deadline (app/daemon.ts SHUTDOWN_TOTAL_MS, 30s) plus room to
// exit: giving up earlier reports a healthy but slow drain as a stop failure.
const STOP_TIMEOUT_MS = 35_000
// 128 + SIGINT(2), the shell convention for "killed by Ctrl-C".
const FORCED_EXIT_CODE = 130
// Bounds a hung start only: a first boot migrates the database, and a daemon that dies is reported
// as soon as it exits.
const START_TIMEOUT_MS = 90_000
const DAEMON_STDOUT_LOG = 'daemon.stdout.log'
// The command's own words always start at argv[2]; how this process relaunches itself is owned by
// `resolveSelfCommand`, which knows the source-entry versus compiled-binary distinction.

const BACKGROUND_SPEC = {
  flags: {
    background: {
      type: 'boolean',
      alias: 'b',
      describe: CLI_FLAG_DESCRIPTIONS.runInBackground,
    },
  },
} as const

export const startCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.start,
  spec: BACKGROUND_SPEC,
  needs: { daemon: 'stopped', bootMode: 'daemon' },
  run: runInChosenMode,
})

export const stopCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.stop,
  needs: { boot: false, configFile: 'optional', daemon: 'any' },
  run: (_args, app) => stopDaemon(app),
})

// The relaunched child runs `restart` again in the foreground; the daemon is already down by then,
// so its own stop step finds nothing to stop.
export const restartCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.restart,
  spec: BACKGROUND_SPEC,
  needs: { daemon: 'any', bootMode: 'daemon', prepareDaemon: 'stop' },
  run: runInChosenMode,
})

export async function stopDaemonIfRunning(app: CliApp): Promise<number> {
  return (await inspectDaemon(app)) === 'absent' ? 0 : stopDaemon(app)
}

function runInChosenMode(args: ParsedArgs, app: CliApp): Promise<number> {
  return flagBool(args, 'background') ? runBackground(app) : runDaemon(app)
}

/** What this daemon will run with, so a start says more than its pid. */
function printDaemonSummary(app: CliApp): void {
  const { config } = app
  const locale = config.locale.language
  const [model] = config.models
  const channels = Object.entries(config.channels)
    .filter(([, channel]) => !isPlainRecord(channel) || channel.enabled !== false)
    .map(([id]) => id)

  if (model !== undefined) {
    app.out(hint(t(locale, 'cli.daemonModel', { model: model.selector })))
  }

  app.out(
    hint(
      t(locale, 'cli.daemonChannels', {
        channels:
          channels.length === 0
            ? t(locale, 'cli.daemonNoChannels', { brand: BRAND.name })
            : channels.join(', '),
      })
    )
  )

  if (config.api.enabled) {
    app.out(hint(t(locale, 'cli.daemonApi', { port: config.api.port })))
  }

  app.out(hint(t(locale, 'cli.daemonLogFile', { path: config.log.file, brand: BRAND.name })))
}

async function runDaemon(app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const abortDaemon = app.abortDaemon

  if (abortDaemon === undefined) {
    app.err(style.error(t(locale, 'cli.daemonShutdownUnavailable')))

    return 1
  }

  const logger = app.resolve('logger')
  let wrotePidFile = false
  let exitCode = 0

  // A second Ctrl-C while the drain is running means the operator is done waiting: leave now.
  const onSignal = (): void => {
    if (app.signal.aborted) {
      process.exit(FORCED_EXIT_CODE)
    }

    abortDaemon()
  }

  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  const unwatchStop = watchStopRequest(app, abortDaemon)

  try {
    await writePidFile(app, process.pid)
    wrotePidFile = true
    app.out(info(t(locale, 'cli.daemonRunning', { pid: process.pid })))
    printDaemonSummary(app)

    await app.resolve('daemonTask').start(app.signal)
  } catch (err: unknown) {
    logger.error('daemon.failed', { err: formatErrForLog(err) })
    app.err(style.error(terminalErrorMessage(err, locale)))

    exitCode = 1
  } finally {
    // Every arm comes down together, whichever way we leave: signals, pid file, abort.
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    unwatchStop()
    abortDaemon()
    const removed = wrotePidFile && (await removePidFile(app))

    if (wrotePidFile && !removed) {
      logger.error('daemon.pid_cleanup_failed', { path: app.config.paths.dataDir })
      app.err(style.error(t(locale, 'cli.daemonPidCleanupFailed')))
      exitCode = 1
    } else if (removed) {
      app.out(success(t(locale, 'cli.daemonStopped')))
    }
  }

  return exitCode
}

async function runBackground(app: CliApp): Promise<number> {
  const locale = app.config.locale.language

  try {
    const { child, logPath } = startDetachedDaemon(app)
    const outcome = await pollUntil(() => startOutcome(app, child), START_TIMEOUT_MS)

    if (outcome === 'exited') {
      app.err(
        style.error(
          t(locale, 'cli.daemonBackgroundExited', {
            code: String(child.exitCode ?? child.signalCode),
            path: logPath,
          })
        )
      )

      return 1
    }

    if (outcome === undefined) {
      app.err(
        style.error(
          t(locale, 'cli.daemonBackgroundStartTimeout', {
            timeout: START_TIMEOUT_MS,
            path: logPath,
          })
        )
      )

      return 1
    }

    app.out(success(t(locale, 'cli.daemonStartedBackground', { pid: child.pid, path: logPath })))
    printDaemonSummary(app)

    return 0
  } catch (err: unknown) {
    app.resolve('logger').error('daemon.background_spawn_failed', { err: formatErrForLog(err) })
    app.err(
      style.error(
        t(locale, 'cli.daemonBackgroundSpawnFailed', {
          message: terminalErrorMessage(err, locale),
        })
      )
    )

    return 1
  }
}

async function startOutcome(app: CliApp, child: Subprocess): Promise<'up' | 'exited' | undefined> {
  if ((await liveDaemonPid(app)) !== null) {
    return 'up'
  }

  // A child killed by a signal reports `signalCode` and leaves `exitCode` null.
  return child.exitCode === null && child.signalCode === null ? undefined : 'exited'
}

// Polls the pid file until the daemon is `up` or `down`; false when the timeout passes first.
async function waitForDaemon(
  app: CliApp,
  target: 'up' | 'down',
  timeoutMs: number
): Promise<boolean> {
  const wantLive = target === 'up'
  const reached = await pollUntil(
    async () => (((await liveDaemonPid(app)) !== null) === wantLive ? true : undefined),
    timeoutMs
  )

  return reached ?? false
}

// Asks `read` every poll interval until it answers; undefined when the timeout passes first.
async function pollUntil<T>(
  read: () => Promise<T | undefined>,
  timeoutMs: number
): Promise<T | undefined> {
  const deadline = performance.now() + timeoutMs

  while (performance.now() < deadline) {
    await sleep(PID_POLL_MS)

    const answer = await read()

    if (answer !== undefined) {
      return answer
    }
  }

  return undefined
}

// Admission already ran pre-boot, so a live daemon never reaches here.
function startDetachedDaemon(app: CliApp): {
  readonly child: Subprocess
  readonly logPath: string
} {
  const logPath = join(app.config.paths.dataDir, DAEMON_STDOUT_LOG)
  // Truncated per start, so the file holds the running daemon's stray output and never grows
  // across restarts. Admission guarantees no other daemon is writing to it.
  const output = openSync(logPath, 'w', PRIVATE_FILE_MODE)

  try {
    const proc = Bun.spawn(buildForegroundArgv(), {
      env: getEnv(),
      detached: true,
      windowsHide: true,
      stdin: 'ignore',
      stdout: output,
      stderr: output,
    })
    proc.unref()

    return { child: proc, logPath }
  } finally {
    // The child holds its own copies; closing ours never silences it.
    closeSync(output)
  }
}

// Same command line minus the background flag. Global flags ride along untouched because they
// were never the command tree's to strip.
function buildForegroundArgv(): string[] {
  const { command, args } = resolveSelfCommand()

  return [command, ...args, ...withoutBackgroundFlag(process.argv.slice(2))]
}

function withoutBackgroundFlag(argv: readonly string[]): string[] {
  return argv.filter((token) => !isBackgroundToken(token))
}

function isBackgroundToken(token: string): boolean {
  return token === '--background' || token === '-b' || token.startsWith('--background=')
}

async function stopDaemon(app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const state = await inspectDaemon(app)

  if (state === 'unreadable') {
    app.err(style.error(t(locale, 'cli.daemonPidUnreadable')))

    return 1
  }

  const pid = await liveDaemonPid(app)

  if (pid === null) {
    if (await clearMalformedPidFile(app)) {
      app.out(success(t(locale, 'cli.daemonMalformedPidRemoved')))

      return 0
    }

    app.out(hint(t(locale, 'cli.daemonNotRunning')))

    return 0
  }

  await requestDaemonStop(app, pid)

  if (await waitForDaemon(app, 'down', STOP_TIMEOUT_MS)) {
    app.out(success(t(locale, 'cli.daemonStoppedWithPid', { pid })))

    return 0
  }

  // The daemon did not go down on its own: say so rather than escalating to SIGKILL behind the operator's back.
  app.err(style.error(t(locale, 'cli.daemonStopTimeout', { pid, timeout: STOP_TIMEOUT_MS })))

  return 1
}
