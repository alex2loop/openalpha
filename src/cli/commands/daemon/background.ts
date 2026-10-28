import type { Subprocess } from 'bun'
import { open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

import type { CliApp } from '@/cli/types'
import { printDaemonSummary } from '@/cli/commands/daemon/summary'
import { buildBackgroundEnv, buildForegroundEnv } from '@/cli/daemon-env'
import { liveDaemon } from '@/cli/daemon-guard'
import { isDaemonReady, readDaemonDegraded } from '@/cli/daemon-ready'
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
export const START_TIMEOUT_MS = 90_000
const DAEMON_STDOUT_LOG = 'daemon.stdout.log'
// Kept apart from stdout so a failed start can quote the daemon's own error and nothing else.
const DAEMON_STDERR_LOG = 'daemon.stderr.log'
const FAILED_DAEMON_STDERR_LOG = 'daemon.stderr.failed.log'
const UPGRADE_STDOUT_LOG = 'upgrade.stdout.log'
const UPGRADE_STDERR_LOG = 'upgrade.stderr.log'
const RESTART_STDOUT_LOG = 'restart.stdout.log'
const RESTART_STDERR_LOG = 'restart.stderr.log'
export const BACKGROUND_FLAG = '--background'
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

/** Starts the daemon in the background on the config file the stopped one loaded and this data dir. */
export async function startBackgroundDaemon(app: CliApp, configPath: string): Promise<number> {
  const argv = await buildSelfArgv({
    dataDir: app.config.paths.dataDir,
    configPath,
    tail: [CLI_COMMAND_METADATA.start.name],
  })

  return await runBackground(app, argv)
}

/** Moves a failed start's error log aside before the next start truncates it. Null when there was
 *  none to keep. */
export async function keepFailedStartLog(dataDir: string): Promise<string | null> {
  const kept = join(dataDir, FAILED_DAEMON_STDERR_LOG)

  try {
    await rename(join(dataDir, DAEMON_STDERR_LOG), kept)

    return kept
  } catch {
    // Missing or not movable: the next start overwrites it, and the reason lines already relayed
    // are all there is.
    return null
  }
}

/** Runs `upgrade` as its own detached process, for a daemon that cannot replace itself. The process
 *  is not a daemon, so it goes without the background mark; the daemon it starts carries one. */
export async function spawnUpgradeProcess(
  app: Pick<CliApp, 'config' | 'configPath'>
): Promise<Subprocess> {
  return await spawnHelperProcess(app, {
    tail: [CLI_COMMAND_METADATA.upgrade.name],
    stdoutLog: UPGRADE_STDOUT_LOG,
    stderrLog: UPGRADE_STDERR_LOG,
  })
}

/** Runs `restart --background` the same way: the daemon cannot stop itself and start again. */
export async function spawnRestartProcess(
  app: Pick<CliApp, 'config' | 'configPath'>
): Promise<Subprocess> {
  return await spawnHelperProcess(app, {
    tail: [CLI_COMMAND_METADATA.restart.name, BACKGROUND_FLAG],
    stdoutLog: RESTART_STDOUT_LOG,
    stderrLog: RESTART_STDERR_LOG,
  })
}

async function spawnHelperProcess(
  app: Pick<CliApp, 'config' | 'configPath'>,
  helper: {
    readonly tail: readonly string[]
    readonly stdoutLog: string
    readonly stderrLog: string
  }
): Promise<Subprocess> {
  const { dataDir } = app.config.paths
  const argv = await buildSelfArgv({ dataDir, configPath: app.configPath, tail: helper.tail })

  return await spawnDetached({
    argv,
    stdoutPath: join(dataDir, helper.stdoutLog),
    stderrPath: join(dataDir, helper.stderrLog),
    env: buildForegroundEnv(),
  })
}

/** A pre-boot caller has no logger, so a spawn failure logs only when one exists. */
export async function runBackground(app: CliApp, argv: readonly string[]): Promise<number> {
  const locale = app.config.locale.language
  let started: DetachedDaemon

  try {
    started = await startDetachedDaemon(app, argv)
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

  return printStartupTimeout(app, child, errorLogPath)
}

async function startOutcome(
  app: CliApp,
  child: Subprocess
): Promise<'ready' | 'exited' | undefined> {
  if (await isDaemonReady(app, child.pid)) {
    return 'ready'
  }

  return isRunning(child) ? undefined : 'exited'
}

// A child killed by a signal reports `signalCode` and leaves `exitCode` null.
function isRunning(child: Subprocess): boolean {
  return child.exitCode === null && child.signalCode === null
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

/** Alive but not ready is a slow boot, not a failure: the daemon is left running. The child is asked,
 *  not the pid file, which is claimed only after boot's migrations. */
async function printStartupTimeout(
  app: CliApp,
  child: Subprocess,
  errorLogPath: string
): Promise<number> {
  const locale = app.config.locale.language

  if (isRunning(child)) {
    app.out(
      warn(
        t(locale, 'cli.daemonBackgroundStillStarting', {
          pid: child.pid,
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
async function startDetachedDaemon(app: CliApp, argv: readonly string[]): Promise<DetachedDaemon> {
  const { dataDir } = app.config.paths
  const logPath = join(dataDir, DAEMON_STDOUT_LOG)
  const errorLogPath = join(dataDir, DAEMON_STDERR_LOG)
  const child = await spawnDetached({
    argv,
    stdoutPath: logPath,
    stderrPath: errorLogPath,
    env: buildBackgroundEnv(),
  })

  return { child, logPath, errorLogPath }
}

/** Truncates both log files per start, so each holds the running process's stray output and never
 *  grows across restarts. The child holds its own copies; closing ours never silences it. */
async function spawnDetached(spawn: DetachedSpawn): Promise<Subprocess> {
  const output = await open(spawn.stdoutPath, 'w', PRIVATE_FILE_MODE)

  try {
    const errors = await open(spawn.stderrPath, 'w', PRIVATE_FILE_MODE)

    try {
      const proc = Bun.spawn([...spawn.argv], {
        env: spawn.env,
        detached: true,
        windowsHide: true,
        stdin: 'ignore',
        stdout: output.fd,
        stderr: errors.fd,
      })
      proc.unref()

      return proc
    } finally {
      await errors.close()
    }
  } finally {
    await output.close()
  }
}
