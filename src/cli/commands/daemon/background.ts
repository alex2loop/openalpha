import type { Subprocess } from 'bun'
import { closeSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { CliApp } from '@/cli/types'
import { printDaemonSummary } from '@/cli/commands/daemon/summary'
import { isDaemonReady, liveDaemonPid, readDaemonDegraded } from '@/cli/daemon-guard'
import { getEnv } from '@/cli/env'
import { terminalErrorMessage } from '@/cli/error-output'
import { resolveSelfCommand } from '@/cli/services'
import { hint, style, success, warn } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { formatErrForLog } from '@/core/security/credentials'
import { PRIVATE_FILE_MODE } from '@/core/security/private-files'
import { sleep } from '@/core/utils/time'
import { t } from '@/i18n'

const PID_POLL_MS = 100
// A background start waits for the daemon to be ready, not merely alive: past the boot refresh's
// own budget (app/boot-refresh.ts, 60s) plus a first boot's migrations. A daemon that dies is
// reported as soon as it exits.
const START_TIMEOUT_MS = 90_000
const DAEMON_STDOUT_LOG = 'daemon.stdout.log'
// Kept apart from stdout so a failed start can quote the daemon's own error and nothing else.
const DAEMON_STDERR_LOG = 'daemon.stderr.log'
const EXIT_REASON_LINES = 3
// Bounds the warnings a ready start relays; the daemon prints one line per degraded item.
const RELAYED_WARNING_LINES = 20

interface DetachedDaemon {
  readonly child: Subprocess
  readonly logPath: string
  readonly errorLogPath: string
}

export async function runBackground(app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  let started: DetachedDaemon

  try {
    started = startDetachedDaemon(app)
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

  const { child, logPath, errorLogPath } = started

  app.out(hint(t(locale, 'cli.daemonBackgroundStarting')))

  const outcome = await pollUntil(() => startOutcome(app, child), START_TIMEOUT_MS)

  if (outcome === 'ready') {
    app.out(
      success(
        t(locale, 'cli.daemonStartedBackground', {
          pid: child.pid,
          version: BRAND.version,
          path: logPath,
        })
      )
    )
    printDaemonSummary(app, await readDaemonDegraded(app, child.pid))

    for (const line of await lastOutputLines(errorLogPath, RELAYED_WARNING_LINES)) {
      app.err(line)
    }

    return 0
  }

  if (outcome === 'exited') {
    await printStartupExit(app, child, errorLogPath)

    return 1
  }

  return printStartupTimeout(app, errorLogPath)
}

async function startOutcome(
  app: CliApp,
  child: Subprocess
): Promise<'ready' | 'exited' | undefined> {
  if (await isDaemonReady(app, child.pid)) {
    return 'ready'
  }

  // A child killed by a signal reports `signalCode` and leaves `exitCode` null.
  return child.exitCode === null && child.signalCode === null ? undefined : 'exited'
}

/** The daemon's own error carries the reason (a rejected token, a bad key), so it leads. */
async function printStartupExit(
  app: CliApp,
  child: Subprocess,
  errorLogPath: string
): Promise<void> {
  const locale = app.config.locale.language

  for (const line of await lastOutputLines(errorLogPath, EXIT_REASON_LINES)) {
    app.err(line)
  }

  app.err(
    style.error(
      t(locale, 'cli.daemonBackgroundExited', {
        code: String(child.exitCode ?? child.signalCode),
        path: errorLogPath,
      })
    )
  )
}

// The file is truncated per start, so it holds this boot's output only.
async function lastOutputLines(path: string, count: number): Promise<readonly string[]> {
  try {
    const text = await readFile(path, 'utf8')

    return text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .slice(-count)
  } catch {
    // An unreadable log leaves the exit line, which names the file, to speak alone.
    return []
  }
}

/** Alive but not ready is a slow boot, not a failure: the daemon is left running. */
async function printStartupTimeout(app: CliApp, errorLogPath: string): Promise<number> {
  const locale = app.config.locale.language
  const pid = await liveDaemonPid(app)

  if (pid !== null) {
    app.out(
      warn(
        t(locale, 'cli.daemonBackgroundStillStarting', {
          pid,
          timeout: START_TIMEOUT_MS,
          path: errorLogPath,
          brand: BRAND.name,
        })
      )
    )

    return 0
  }

  app.err(
    style.error(
      t(locale, 'cli.daemonBackgroundStartTimeout', {
        timeout: START_TIMEOUT_MS,
        path: errorLogPath,
      })
    )
  )

  return 1
}

// Asks `read` every poll interval until it answers; undefined when the timeout passes first.
export async function pollUntil<T>(
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
function startDetachedDaemon(app: CliApp): DetachedDaemon {
  const { dataDir } = app.config.paths
  const logPath = join(dataDir, DAEMON_STDOUT_LOG)
  const errorLogPath = join(dataDir, DAEMON_STDERR_LOG)
  // Truncated per start, so each file holds the running daemon's stray output and never grows
  // across restarts. Admission guarantees no other daemon is writing to them.
  const output = openSync(logPath, 'w', PRIVATE_FILE_MODE)

  try {
    const errors = openSync(errorLogPath, 'w', PRIVATE_FILE_MODE)

    try {
      const proc = Bun.spawn(buildForegroundArgv(), {
        env: getEnv(),
        detached: true,
        windowsHide: true,
        stdin: 'ignore',
        stdout: output,
        stderr: errors,
      })
      proc.unref()

      return { child: proc, logPath, errorLogPath }
    } finally {
      closeSync(errors)
    }
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
