import type { PidFileClaim, RunningDaemon } from '@/cli/daemon-guard'
import type { CliApp } from '@/cli/types'
import type { DaemonStartOptions, DegradedItem, TaskSnapshot } from '@/core/container'
import { type Command, createCommand } from '@/cli/command'
import {
  BACKGROUND_FLAG,
  pollUntil,
  runBackground,
  START_TIMEOUT_MS,
} from '@/cli/commands/daemon/background'
import {
  printServed,
  printSettledTask,
  printStartSetup,
  printTasks,
  renderDegraded,
  reportMissingKeys,
} from '@/cli/commands/daemon/summary'
import {
  clearMalformedPidFile,
  inspectDaemon,
  liveDaemon,
  liveDaemonPid,
  removePidFile,
  requestDaemonStop,
  restoreStalePidFile,
  watchStopRequest,
  writePidFile,
} from '@/cli/daemon-guard'
import { clearReadyFile, isDaemonReady, writeReadyFile } from '@/cli/daemon-ready'
import { canRestartInPlace, RESTART_SIGNAL, requestRestartInPlace } from '@/cli/daemon-restart'
import { getEnv } from '@/cli/env'
import { terminalErrorMessage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA, CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { toKeylessItems } from '@/cli/missing-keys'
import { flagBool, type ParsedArgs, parseArgs } from '@/cli/parsing/args'
import { resolveSelfCommand } from '@/cli/services'
import { hint, info, style, success, warn } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

// Outlasts the daemon's own shutdown deadline (app/daemon.ts SHUTDOWN_TOTAL_MS, 30s) plus room to
// exit: giving up earlier reports a healthy but slow drain as a stop failure.
const STOP_TIMEOUT_MS = 35_000
// 128 + SIGINT(2), the shell convention for "killed by Ctrl-C".
const FORCED_EXIT_CODE = 130

const BACKGROUND_SPEC = {
  flags: {
    background: {
      type: 'boolean',
      alias: 'b',
      describe: CLI_FLAG_DESCRIPTIONS.runInBackground,
    },
  },
} as const

const RESTART_SPEC = {
  flags: {
    ...BACKGROUND_SPEC.flags,
    now: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.restartNow },
  },
} as const

/** Whether this start reached ready, which decides what its pid file leaves behind. */
interface StartRun {
  ready: boolean
}

/** What this run's ready file holds besides the pid, kept whole because every write replaces it. */
interface ReadyRecord {
  boot: readonly DegradedItem[]
  health: readonly DegradedItem[]
  tasks: readonly TaskSnapshot[]
  /** The tasks working when the daemon got ready, each announced once as it settles. */
  readonly awaited: Set<string>
}

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

// A running daemon is asked to restart itself before boot; otherwise it is stopped, and the
// relaunched child runs `restart` again in the foreground, where its own stop step finds nothing
// to stop.
export const restartCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.restart,
  spec: RESTART_SPEC,
  needs: { daemon: 'any', bootMode: 'daemon', prepareDaemon: 'restart' },
  run: runInChosenMode,
})

export function readRestartFlags(argv: readonly string[]): {
  readonly background: boolean
  readonly now: boolean
} {
  const args = parseArgs(argv, RESTART_SPEC)

  return { background: flagBool(args, 'background'), now: flagBool(args, 'now') }
}

export async function stopDaemonIfRunning(app: CliApp): Promise<number> {
  return (await inspectDaemon(app)) === 'absent' ? 0 : stopDaemon(app)
}

function runInChosenMode(args: ParsedArgs, app: CliApp): Promise<number> {
  return flagBool(args, 'background') ? runBackground(app, buildForegroundArgv()) : runDaemon(app)
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
  return token === BACKGROUND_FLAG || token === '-b' || token.startsWith(`${BACKGROUND_FLAG}=`)
}

async function runDaemon(app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const abortDaemon = app.abortDaemon

  if (abortDaemon === undefined) {
    app.err(style.error(t(locale, 'cli.daemonShutdownUnavailable')))

    return 1
  }

  const logger = app.resolve('logger')
  const keyless = toKeylessItems(app.config, getEnv())
  const run: StartRun = { ready: false }
  let claim: PidFileClaim | undefined
  let exitCode = 0

  const unwatchSignals = watchStopSignals(app, abortDaemon)
  const unwatchStop = watchStopRequest(app, abortDaemon)

  try {
    claim = await writePidFile(app, process.pid)
    await clearReadyFile(app)
    printStartBanner(app, keyless)

    await app.resolve('daemonTask').start(app.signal, toStartOptions(app, { keyless, claim, run }))
  } catch (err: unknown) {
    logger.error('daemon.failed', { err: formatErrForLog(err) })
    app.err(style.error(terminalErrorMessage(err, locale)))

    exitCode = 1
  } finally {
    // Every arm comes down together, whichever way we leave: signals, pid file, abort.
    unwatchSignals()
    unwatchStop()
    abortDaemon()
    const removed =
      claim !== undefined && (await releasePidFile(app, run.ready ? undefined : claim))

    if (claim !== undefined && !removed) {
      logger.error('daemon.pid_cleanup_failed', { path: app.config.paths.dataDir })
      app.err(style.error(t(locale, 'cli.daemonPidCleanupFailed')))
      exitCode = 1
    } else if (removed) {
      app.out(success(t(locale, 'cli.daemonStopped')))
    }
  }

  return exitCode
}

/** Ctrl-C and SIGTERM stop the daemon; the restart signal stops it too and asks the entry to start
 *  it again. A second stop signal while the drain runs means the operator is done waiting: leave
 *  now, which also drops a pending restart. A stop already under way wins over a restart signal. */
function watchStopSignals(app: CliApp, abortDaemon: () => void): () => void {
  const onStop = (): void => {
    if (app.signal.aborted) {
      process.exit(FORCED_EXIT_CODE)
    }

    abortDaemon()
  }
  const onRestart = (): void => {
    if (!app.signal.aborted) {
      requestRestartInPlace()
      abortDaemon()
    }
  }

  process.on('SIGINT', onStop)
  process.on('SIGTERM', onStop)

  if (canRestartInPlace()) {
    process.on(RESTART_SIGNAL, onRestart)
  }

  return () => {
    process.off('SIGINT', onStop)
    process.off('SIGTERM', onStop)
    process.off(RESTART_SIGNAL, onRestart)
  }
}

/** Drops this run's pid file. A start that never got ready puts back the stale file it reclaimed,
 *  so the next start still tells the operator the run before it stopped unexpectedly. */
async function releasePidFile(
  app: CliApp,
  unannounced: PidFileClaim | undefined
): Promise<boolean> {
  const removed = await removePidFile(app)

  if (
    removed &&
    unannounced?.kind === 'reclaimed' &&
    !(await restoreStalePidFile(app, unannounced.stale))
  ) {
    app.resolve('logger').warn('daemon.stale_pid_restore_failed', {
      path: app.config.paths.dataDir,
    })
  }

  return removed
}

/** What the daemon task is told about this start. The boot list is kept so a channel that drops
 *  later, or a task that changes, is written beside it in the ready file `status` reads. */
function toStartOptions(
  app: CliApp,
  start: {
    readonly keyless: readonly DegradedItem[]
    readonly claim: PidFileClaim
    readonly run: StartRun
  }
): DaemonStartOptions {
  const { keyless, claim, run } = start
  const record: ReadyRecord = { boot: keyless, health: [], tasks: [], awaited: new Set() }

  return {
    onReady: (degraded) => {
      run.ready = true
      record.boot = [...keyless, ...degraded]
      announceReady(app, record)
    },
    onHealth: (channelItems) => {
      record.health = channelItems
      recordReady(app, record)
    },
    onTasks: (tasks) => {
      record.tasks = tasks

      if (run.ready) {
        announceSettled(app, record)
        recordReady(app, record)
      }
    },
    ...(claim.kind === 'reclaimed'
      ? { previousRun: claim.startedAt === undefined ? {} : { startedAt: claim.startedAt } }
      : {}),
  }
}

function printStartBanner(app: CliApp, keyless: readonly DegradedItem[]): void {
  const locale = app.config.locale.language

  app.out(info(t(locale, 'cli.daemonRunning', { pid: process.pid, version: BRAND.version })))
  printStartSetup(app)
  reportMissingKeys(app, keyless)
}

// What a channel or the API left down goes out before the ready file, so a background start relays
// it with its confirmation; the ready file then records the whole list for `status`. A failed write
// never stops the running daemon, but says so: a background start would otherwise wait it out.
function announceReady(app: CliApp, record: ReadyRecord): void {
  const entries = record.boot.map((item) => renderDegraded(app, item))

  printServed(app, entries)

  for (const entry of entries.filter(({ kind }) => kind === 'channel' || kind === 'api')) {
    app.err(warn(entry.message))
  }

  printTasks(app, record.tasks)

  for (const task of record.tasks.filter((entry) => entry.working)) {
    record.awaited.add(task.label)
  }

  recordReady(app, record)
}

// Only the work running at start is followed to its end; the terminal stays quiet after that.
function announceSettled(app: CliApp, record: ReadyRecord): void {
  for (const task of record.tasks) {
    if (!task.working && record.awaited.delete(task.label)) {
      printSettledTask(app, task)
    }
  }
}

function recordReady(app: CliApp, record: ReadyRecord): void {
  const entries = [...record.boot, ...record.health].map((item) => renderDegraded(app, item))

  writeReadyFile(app, entries, record.tasks).catch((err: unknown) => {
    app.resolve('logger').warn('daemon.ready_file_failed', { err: formatErrForLog(err) })
    app.err(warn(t(app.config.locale.language, 'cli.daemonReadyFileFailed')))
  })
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

/** The pid stays the same across a restart in place, so the new run is the one with a later start,
 *  once it is ready. `waitMs` covers the idle wait the request asked for. */
export async function waitForRestart(
  app: CliApp,
  previous: { readonly startedAt?: number },
  waitMs: number
): Promise<RunningDaemon | undefined> {
  return await pollUntil(
    async () => {
      const daemon = await liveDaemon(app)

      return daemon !== null &&
        daemon.startedAt !== previous.startedAt &&
        (await isDaemonReady(app, daemon.pid))
        ? daemon
        : undefined
    },
    waitMs + STOP_TIMEOUT_MS + START_TIMEOUT_MS
  )
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
