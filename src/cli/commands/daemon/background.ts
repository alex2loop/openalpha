import type { Subprocess } from 'bun'
import { closeSync, openSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { CliApp } from '@/cli/types'
import { printDaemonSummary } from '@/cli/commands/daemon/summary'
import {
  buildBackgroundEnv,
  isDaemonReady,
  liveDaemon,
  liveDaemonPid,
  readDaemonDegraded,
} from '@/cli/daemon-guard'
import { terminalErrorMessage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { buildSelfArgv } from '@/cli/services'
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

interface DetachedSpawn {
  readonly argv: readonly string[]
  readonly stdoutPath: string
  readonly stderrPath: string
  readonly env: Readonly<Record<string, string | undefined>>
}

interface DetachedDaemon {
  readonly child: Subprocess
  readonly logPath: string
  readonly errorLogPath: string
}

/** Starts the daemon in the background from the stopped one's own command line, so it loads the
 *  same config and data dir. A pre-boot caller has no logger, so a spawn failure logs only when one
 *  exists. */
export function startBackgroundDaemon(app: CliApp, configPath: string): Promise<number> {
  const tail = [CLI_COMMAND_METADATA.start.name]

  return Bun.file(configPath)
    .exists()
    .then((present) =>
      runBackground(
        app,
        buildSelfArgv({
          dataDir: app.config.paths.dataDir,
          configPath: present ? configPath : undefined,
          tail,
        })
      )
    )
}

export async function runBackground(app: CliApp, argv: readonly string[]): Promise<number> {
  const locale = app.config.locale.language
  let started: DetachedDaemon

  try {
    started = startDetachedDaemon(app, argv)
  } catch (err: unknown) {
    if (app.has('logger')) {
      app.resolve('logger').error('daemon.background_spawn_failed', { err: formatErrForLog(err) })
    }

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
          // The daemon may run a release other than this process's, as right after `upgrade`.
          version: (await liveDaemon(app))?.version ?? BRAND.version,
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
function startDetachedDaemon(app: CliApp, argv: readonly string[]): DetachedDaemon {
  const { dataDir } = app.config.paths
  const logPath = join(dataDir, DAEMON_STDOUT_LOG)
  const errorLogPath = join(dataDir, DAEMON_STDERR_LOG)
  const child = spawnDetached({
    argv,
    stdoutPath: logPath,
    stderrPath: errorLogPath,
    env: buildBackgroundEnv(),
  })

  return { child, logPath, errorLogPath }
}

/** Truncates both log files per start, so each holds the running process's stray output and never
 *  grows across restarts. The child holds its own copies; closing ours never silences it. */
export function spawnDetached(spawn: DetachedSpawn): Subprocess {
  const output = openSync(spawn.stdoutPath, 'w', PRIVATE_FILE_MODE)

  try {
    const errors = openSync(spawn.stderrPath, 'w', PRIVATE_FILE_MODE)

    try {
      const proc = Bun.spawn([...spawn.argv], {
        env: spawn.env,
        detached: true,
        windowsHide: true,
        stdin: 'ignore',
        stdout: output,
        stderr: errors,
      })
      proc.unref()

      return proc
    } finally {
      closeSync(errors)
    }
  } finally {
    closeSync(output)
  }
}
