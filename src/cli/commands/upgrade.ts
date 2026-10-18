import { rm } from 'node:fs/promises'

import type { RunningDaemon } from '@/cli/daemon-guard'
import type { CliApp } from '@/cli/types'
import { type Command, createCommand } from '@/cli/command'
import { keepFailedStartLog, startBackgroundDaemon } from '@/cli/commands/daemon/background'
import { stopDaemonIfRunning } from '@/cli/commands/daemon/daemon'
import { liveDaemon } from '@/cli/daemon-guard'
import { isInteractiveStderr } from '@/cli/env'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { formatArgIssue } from '@/cli/parsing/arg-issue'
import { fail, hint, info, success } from '@/cli/ui/colors'
import {
  DOWNLOAD_PATH,
  hasPreviousBinary,
  installDownloadedBinary,
  swapWithPreviousBinary,
} from '@/cli/update/binary'
import { formatUpdateStatus } from '@/cli/update/notice'
import { downloadReleaseBinary, isCompiledBinary } from '@/cli/update/release'
import {
  newerVersionOf,
  patchUpdateState,
  refreshUpdateState,
  type UpdateState,
} from '@/cli/update/state'
import { BRAND } from '@/core/brand'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { compareVersions } from '@/core/utils/version'
import { t } from '@/i18n'

const DOWNLOAD_TIMEOUT_MS = 5 * MS_PER_MINUTE
const START_COMMAND = `${BRAND.name} ${CLI_COMMAND_METADATA.start.name} --background`

export const upgradeCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.upgrade,
  needs: { boot: false, configFile: 'optional', daemon: 'any' },
  spec: {
    flags: {
      check: { type: 'boolean', describe: { key: 'cliHelp.flagUpgradeCheck' } },
      rollback: { type: 'boolean', describe: { key: 'cliHelp.flagUpgradeRollback' } },
    },
  },
  run: (args, app) =>
    runUpgrade(app, { checkOnly: args.check === true, rollback: args.rollback === true }),
})

interface UpgradeOptions {
  readonly checkOnly: boolean
  readonly rollback: boolean
}

// A daemon `upgrade` may start again by itself: one with no terminal or service to own it, whose
// pid file says which config it loaded.
type RestartableDaemon = RunningDaemon & { readonly background: true; readonly configPath: string }

interface DaemonSwitch {
  readonly daemon: RunningDaemon | null
  readonly version: string
}

async function runUpgrade(app: CliApp, options: UpgradeOptions): Promise<number> {
  const locale = app.config.locale.language

  if (options.checkOnly && options.rollback) {
    app.err(
      fail(formatArgIssue(locale, { token: '--check/--rollback', code: 'conflicting_flags' }))
    )

    return 1
  }

  if (!isCompiledBinary()) {
    app.err(fail(t(locale, 'cli.upgradeSourceCheckout')))

    return 1
  }

  if (options.rollback) {
    return await rollbackRelease(app)
  }

  const state = await refreshUpdateState({ dataDir: app.config.paths.dataDir, now: Date.now() })
  const latest = newerVersionOf(state)

  if (latest !== null && !options.checkOnly) {
    return await installRelease(app, latest)
  }

  printStatus(app, state)

  const statusCode = latest === null && state.failed ? 1 : 0

  if (latest !== null || options.checkOnly) {
    return statusCode
  }

  return (await restartStaleDaemon(app)) || statusCode
}

function printStatus(app: CliApp, state: UpdateState): void {
  for (const line of formatUpdateStatus(app.config.locale.language, state)) {
    app.out(line)
  }
}

async function installRelease(app: CliApp, latest: string): Promise<number> {
  const locale = app.config.locale.language
  const current = `v${BRAND.version}`

  app.out(
    info(t(locale, 'cli.upgradeStarting', { brand: BRAND.display, current, latest: `v${latest}` }))
  )

  try {
    const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    // A network error or an install dir that cannot be written leaves the old binary in place, as a
    // checksum mismatch does.
    const verified = await downloadReleaseBinary(latest, DOWNLOAD_PATH, signal).catch(() => false)

    if (!verified) {
      app.err(fail(t(locale, 'cli.upgradeFailed', { current })))

      return 1
    }

    return await switchRelease(app, latest)
  } finally {
    await rm(DOWNLOAD_PATH, { force: true })
  }
}

/** The daemon is paused only once a verified binary is in hand, so a failed download never stops
 *  it. */
async function switchRelease(app: CliApp, latest: string): Promise<number> {
  const locale = app.config.locale.language
  const daemon = await liveDaemon(app)
  const paused = toPause(daemon)

  if (paused !== null) {
    app.out(info(t(locale, 'cli.upgradeStoppingDaemon')))

    const stopped = await stopForSwap(app, paused)

    if (stopped !== 0) {
      return stopped
    }
  }

  try {
    await installDownloadedBinary()
  } catch {
    app.err(fail(t(locale, 'cli.upgradeFailed', { current: `v${BRAND.version}` })))
    await recoverStoppedDaemon(app, paused)

    return 1
  }

  // Only a reader at a terminal saw the line below; a daemon's own upgrade writes to a log, and the
  // next command there says which release now runs.
  if (isInteractiveStderr()) {
    await recordUpdateState(app, { announcedVersion: latest })
  }

  app.out(success(t(locale, 'cli.upgradeDone', { brand: BRAND.display, latest: `v${latest}` })))

  return await resumeDaemon(app, { daemon, version: latest })
}

/** A stop that times out may still finish late: a daemon that went down by then comes back on the
 *  binary as it stands, so a slow drain never leaves the bot down. */
async function stopForSwap(app: CliApp, daemon: RunningDaemon): Promise<number> {
  const stopped = await stopDaemonIfRunning(app)

  if (stopped !== 0 && (await liveDaemon(app)) === null) {
    await recoverStoppedDaemon(app, daemon)
  }

  return stopped
}

/** The binary did not change, so the daemon stopped for the swap goes back up on it. */
async function recoverStoppedDaemon(app: CliApp, daemon: RunningDaemon | null): Promise<void> {
  if (daemon === null) {
    return
  }

  if (isRestartable(daemon)) {
    await startBackgroundDaemon(app, daemon.configPath)

    return
  }

  const locale = app.config.locale.language

  app.err(hint(t(locale, 'cli.upgradeFailedDaemonDown', { command: START_COMMAND })))
}

async function resumeDaemon(app: CliApp, change: DaemonSwitch): Promise<number> {
  const daemon = restartableOrHint(app, change.daemon)

  if (daemon === null) {
    return 0
  }

  app.out(info(t(app.config.locale.language, 'cli.upgradeRestartingDaemon')))

  const started = await startBackgroundDaemon(app, daemon.configPath)

  return started === 0 ? 0 : await restorePreviousRelease(app, { ...change, daemon })
}

/** A release that will not start is swapped out for the one that ran, and recorded before the old
 *  one starts: that daemon tells the chat as soon as it is ready, and must read the rollback. If the
 *  old one will not start either, the operator is told and left to look. */
async function restorePreviousRelease(
  app: CliApp,
  change: DaemonSwitch & { readonly daemon: RestartableDaemon }
): Promise<number> {
  const locale = app.config.locale.language

  try {
    await swapWithPreviousBinary()
  } catch {
    app.err(fail(t(locale, 'cli.upgradeRollbackFailed', { command: START_COMMAND })))

    return 1
  }

  const failedLog = await keepFailedStartLog(app.config.paths.dataDir)

  // The version announced to the operator is the one that runs again, so a later upgrade to this
  // release still announces itself.
  await recordUpdateState(app, {
    rolledBackVersion: change.version,
    announcedVersion: BRAND.version,
  })

  const started = await startBackgroundDaemon(app, change.daemon.configPath)

  if (started === 0) {
    app.err(
      fail(
        t(locale, 'cli.upgradeRolledBack', {
          brand: BRAND.display,
          failed: `v${change.version}`,
          current: `v${BRAND.version}`,
        })
      )
    )
  } else {
    app.err(hint(t(locale, 'cli.upgradeFailedDaemonDown', { command: START_COMMAND })))
  }

  if (failedLog !== null) {
    app.err(hint(t(locale, 'cli.upgradeFailedLog', { path: failedLog })))
  }

  return 1
}

/** A daemon left on an older release, say by an install script that swapped the binary, comes up
 *  on this one. A foreground or service daemon is only pointed out; a newer one is left alone. */
async function restartStaleDaemon(app: CliApp): Promise<number> {
  const daemon = await liveDaemon(app)

  if (
    daemon === null ||
    daemon.version === undefined ||
    compareVersions(daemon.version, BRAND.version) >= 0
  ) {
    return 0
  }

  if (!isRestartable(daemon)) {
    printVersionMismatch(app)

    return 0
  }

  const stopped = await stopForSwap(app, daemon)

  return stopped === 0 ? await startBackgroundDaemon(app, daemon.configPath) : stopped
}

async function rollbackRelease(app: CliApp): Promise<number> {
  const locale = app.config.locale.language

  if (!(await hasPreviousBinary())) {
    app.err(fail(t(locale, 'cli.upgradeNoPrevious')))

    return 1
  }

  const daemon = await liveDaemon(app)
  const paused = toPause(daemon)
  const stopped = paused === null ? 0 : await stopForSwap(app, paused)

  if (stopped !== 0) {
    return stopped
  }

  try {
    await swapWithPreviousBinary()
  } catch {
    app.err(fail(t(locale, 'cli.upgradeRollbackFailed', { command: START_COMMAND })))
    await recoverStoppedDaemon(app, paused)

    return 1
  }

  // The release being left is not reinstalled by an automatic update. Both surfaces record the one
  // coming back without announcing it, so a later upgrade to the release left still announces.
  await recordUpdateState(app, {
    rolledBackVersion: BRAND.version,
    announcedVersion: null,
    chatAnnouncedVersion: null,
  })
  app.out(success(t(locale, 'cli.upgradeRollbackDone')))

  const restartable = restartableOrHint(app, daemon)

  return restartable === null ? 0 : await startBackgroundDaemon(app, restartable.configPath)
}

function isRestartable(daemon: RunningDaemon): daemon is RestartableDaemon {
  return daemon.background === true && daemon.configPath !== undefined
}

/** The daemon to stop for a swap. Windows cannot replace a running binary, so every daemon stops
 *  there; elsewhere only one this command starts again, and a terminal or service daemon keeps
 *  running the old release until its owner restarts it. */
function toPause(daemon: RunningDaemon | null): RunningDaemon | null {
  if (daemon === null) {
    return null
  }

  return isRestartable(daemon) || process.platform === 'win32' ? daemon : null
}

/** The daemon to start again after a swap, or null after telling the operator how to move the one
 *  that ran onto the binary now in place. */
function restartableOrHint(app: CliApp, daemon: RunningDaemon | null): RestartableDaemon | null {
  if (daemon === null) {
    return null
  }

  if (isRestartable(daemon)) {
    return daemon
  }

  if (toPause(daemon) === null) {
    printVersionMismatch(app)
  } else {
    app.out(
      hint(t(app.config.locale.language, 'cli.upgradeRestartDaemon', { command: START_COMMAND }))
    )
  }

  return null
}

// The data dir is only a hint store: one that cannot be written never fails an upgrade.
async function recordUpdateState(app: CliApp, patch: Partial<UpdateState>): Promise<void> {
  await patchUpdateState(app.config.paths.dataDir, patch).catch(() => undefined)
}

function printVersionMismatch(app: CliApp): void {
  app.err(
    hint(
      t(app.config.locale.language, 'cli.statusDaemonVersionMismatch', {
        installed: BRAND.version,
        brand: BRAND.name,
      })
    )
  )
}
