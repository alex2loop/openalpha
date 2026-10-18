import { chmod, rename, rm } from 'node:fs/promises'

import type { CliApp } from '@/cli/types'
import { type Command, createCommand } from '@/cli/command'
import { stopDaemonIfRunning } from '@/cli/commands/daemon/daemon'
import { liveDaemonPid } from '@/cli/daemon-guard'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { fail, hint, info, success } from '@/cli/ui/colors'
import { formatUpdateStatus } from '@/cli/update/notice'
import { downloadReleaseBinary, isCompiledBinary } from '@/cli/update/release'
import { newerVersionOf, refreshUpdateState } from '@/cli/update/state'
import { BRAND } from '@/core/brand'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { t } from '@/i18n'

const DOWNLOAD_TIMEOUT_MS = 5 * MS_PER_MINUTE
const BINARY_MODE = 0o755
// `upgrade` only runs from a compiled binary, so this is the file it replaces.
const BINARY_PATH = process.execPath
// Next to the binary, so the rename stays on one filesystem and is atomic.
const DOWNLOAD_PATH = `${BINARY_PATH}.download`
// Windows will rename a running binary but never replace or delete it, so the old one steps aside
// here; the next upgrade's rename overwrites it once nothing runs it.
const RETIRED_PATH = `${BINARY_PATH}.old`
const START_COMMAND = `${BRAND.name} ${CLI_COMMAND_METADATA.start.name} --background`

export const upgradeCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.upgrade,
  needs: { boot: false, configFile: 'optional', daemon: 'any' },
  spec: { flags: { check: { type: 'boolean', describe: { key: 'cliHelp.flagUpgradeCheck' } } } },
  run: (args, app) => runUpgrade(app, { checkOnly: args.check === true }),
})

interface UpgradeOptions {
  readonly checkOnly: boolean
}

async function runUpgrade(app: CliApp, options: UpgradeOptions): Promise<number> {
  const locale = app.config.locale.language

  if (!isCompiledBinary()) {
    app.err(fail(t(locale, 'cli.upgradeSourceCheckout')))

    return 1
  }

  const state = await refreshUpdateState({ dataDir: app.config.paths.dataDir, now: Date.now() })
  const latest = newerVersionOf(state)

  if (latest === null || options.checkOnly) {
    for (const line of formatUpdateStatus(locale, state)) {
      app.out(line)
    }

    return latest === null && state.failed ? 1 : 0
  }

  return await installRelease(app, latest)
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

    return await swapBinary(app, latest)
  } finally {
    await rm(DOWNLOAD_PATH, { force: true })
  }
}

/** The daemon is paused only once a verified binary is in hand, so a failed download never stops
 *  it; left running, it would keep serving the old version. */
async function swapBinary(app: CliApp, latest: string): Promise<number> {
  const locale = app.config.locale.language
  const daemonWasRunning = (await liveDaemonPid(app)) !== null

  if (daemonWasRunning) {
    app.out(info(t(locale, 'cli.upgradeStoppingDaemon')))

    const stopped = await stopDaemonIfRunning(app)

    if (stopped !== 0) {
      return stopped
    }
  }

  try {
    await chmod(DOWNLOAD_PATH, BINARY_MODE)
    await moveIntoPlace()
  } catch {
    app.err(fail(t(locale, 'cli.upgradeFailed', { current: `v${BRAND.version}` })))

    if (daemonWasRunning) {
      app.err(hint(t(locale, 'cli.upgradeFailedDaemonDown', { command: START_COMMAND })))
    }

    return 1
  }

  app.out(success(t(locale, 'cli.upgradeDone', { brand: BRAND.display, latest: `v${latest}` })))

  if (daemonWasRunning) {
    app.out(hint(t(locale, 'cli.upgradeRestartDaemon', { command: START_COMMAND })))
  }

  return 0
}

async function moveIntoPlace(): Promise<void> {
  if (process.platform !== 'win32') {
    await rename(DOWNLOAD_PATH, BINARY_PATH)

    return
  }

  await rename(BINARY_PATH, RETIRED_PATH)

  try {
    await rename(DOWNLOAD_PATH, BINARY_PATH)
  } catch (err: unknown) {
    await rename(RETIRED_PATH, BINARY_PATH)

    throw err
  }
}
