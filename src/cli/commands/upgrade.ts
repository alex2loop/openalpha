import { rm } from 'node:fs/promises'

import type { RunningDaemon } from '@/cli/daemon-guard'
import type { CliApp } from '@/cli/types'
import { type Command, createCommand } from '@/cli/command'
import { startBackgroundDaemon } from '@/cli/commands/daemon/background'
import { stopDaemonIfRunning } from '@/cli/commands/daemon/daemon'
import { liveDaemon } from '@/cli/daemon-guard'
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
  readUpdateState,
  refreshUpdateState,
  type UpdateState,
  writeUpdateState,
} from '@/cli/update/state'
import { BRAND } from '@/core/brand'
import { MS_PER_MINUTE } from '@/core/utils/time'
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
 *  it; left running, it would keep serving the old version. */
async function switchRelease(app: CliApp, latest: string): Promise<number> {
  const locale = app.config.locale.language
  const daemon = await liveDaemon(app)

  if (daemon !== null) {
    app.out(info(t(locale, 'cli.upgradeStoppingDaemon')))

    const stopped = await stopDaemonIfRunning(app)

    if (stopped !== 0) {
      return stopped
    }
  }

  try {
    await installDownloadedBinary()
  } catch {
    app.err(fail(t(locale, 'cli.upgradeFailed', { current: `v${BRAND.version}` })))
    await recoverStoppedDaemon(app, daemon)

    return 1
  }

  await patchUpdateState(app, { announcedVersion: latest })
  app.out(success(t(locale, 'cli.upgradeDone', { brand: BRAND.display, latest: `v${latest}` })))

  return await resumeDaemon(app, { daemon, version: latest })
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
  const { daemon } = change
  const locale = app.config.locale.language

  if (daemon === null) {
    return 0
  }

  if (!isRestartable(daemon)) {
    app.out(hint(t(locale, 'cli.upgradeRestartDaemon', { command: START_COMMAND })))

    return 0
  }

  app.out(info(t(locale, 'cli.upgradeRestartingDaemon')))

  const started = await startBackgroundDaemon(app, daemon.configPath)

  return started === 0 ? 0 : await restorePreviousRelease(app, { ...change, daemon })
}

/** A release that will not start is swapped out for the one that ran. There is no second rollback:
 *  if the old one will not start either, the operator is told and left to look. */
async function restorePreviousRelease(
  app: CliApp,
  change: DaemonSwitch & { readonly daemon: RestartableDaemon }
): Promise<number> {
  const locale = app.config.locale.language

  await swapWithPreviousBinary()
  // The version announced to the operator is the one that runs again, so a later upgrade to this
  // release still announces itself.
  await patchUpdateState(app, {
    rolledBackVersion: change.version,
    announcedVersion: BRAND.version,
  })
  app.err(
    fail(
      t(locale, 'cli.upgradeRolledBack', {
        brand: BRAND.display,
        failed: `v${change.version}`,
        current: `v${BRAND.version}`,
      })
    )
  )
  await startBackgroundDaemon(app, change.daemon.configPath)

  return 1
}

/** A daemon left on an older release, say by an install script that swapped the binary, comes up
 *  on this one. A foreground or service daemon is only pointed out. */
async function restartStaleDaemon(app: CliApp): Promise<number> {
  const daemon = await liveDaemon(app)

  if (daemon === null || daemon.version === undefined || daemon.version === BRAND.version) {
    return 0
  }

  if (!isRestartable(daemon)) {
    const locale = app.config.locale.language

    app.err(
      hint(
        t(locale, 'cli.statusDaemonVersionMismatch', {
          installed: BRAND.version,
          brand: BRAND.name,
        })
      )
    )

    return 0
  }

  const stopped = await stopDaemonIfRunning(app)

  return stopped === 0 ? await startBackgroundDaemon(app, daemon.configPath) : stopped
}

async function rollbackRelease(app: CliApp): Promise<number> {
  const locale = app.config.locale.language

  if (!(await hasPreviousBinary())) {
    app.err(fail(t(locale, 'cli.upgradeNoPrevious')))

    return 1
  }

  const daemon = await liveDaemon(app)
  const stopped = daemon === null ? 0 : await stopDaemonIfRunning(app)

  if (stopped !== 0) {
    return stopped
  }

  await swapWithPreviousBinary()
  // The release left behind is the one running this command; auto update must not reinstall it.
  await patchUpdateState(app, { announcedVersion: null, rolledBackVersion: BRAND.version })
  app.out(success(t(locale, 'cli.upgradeRollbackDone')))

  if (daemon === null) {
    return 0
  }

  if (!isRestartable(daemon)) {
    app.out(hint(t(locale, 'cli.upgradeRestartDaemon', { command: START_COMMAND })))

    return 0
  }

  return await startBackgroundDaemon(app, daemon.configPath)
}

function isRestartable(daemon: RunningDaemon): daemon is RestartableDaemon {
  return daemon.background === true && daemon.configPath !== undefined
}

// The data dir is only a hint store: one that cannot be written never fails an upgrade.
async function patchUpdateState(app: CliApp, patch: Partial<UpdateState>): Promise<void> {
  const dataDir = app.config.paths.dataDir
  const state = await readUpdateState(dataDir)

  await writeUpdateState(dataDir, { ...state, ...patch }).catch(() => undefined)
}
