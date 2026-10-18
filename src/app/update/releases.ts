import type { ReleaseUpdates, UpgradeReply, UpgradeRequest } from '@/commands/api'
import type { App } from '@/core/container'
import {
  formatInstalledNotice,
  formatUpdateNotice,
  isUpdateCheckEnabled,
  newerVersionOf,
  readFreshUpdateState,
  toChatText,
  UPGRADE_COMMAND,
  writeUpdateState,
} from '@/cli/api'
import { t } from '@/i18n'

const CHANNEL_SURFACE = 'channel'

export function createReleaseUpdates(app: App): ReleaseUpdates {
  return { describe: (request) => describeRelease(app, request) }
}

async function describeRelease(app: App, request: UpgradeRequest): Promise<UpgradeReply> {
  const { locale } = request
  const dataDir = app.config.paths.dataDir

  if (!(await isUpdateCheckEnabled(app.config))) {
    return {
      text: t(locale, app.config.update.check ? 'cli.upgradeSourceCheckout' : 'cli.updateCheckOff'),
    }
  }

  const now = Date.now()
  const state = await readFreshUpdateState(dataDir, { now, signal: request.signal })

  if (newerVersionOf(state) === null) {
    const lines = formatInstalledNotice(locale, state)

    const verdict = t(locale, state.failed ? 'cli.updateUnchecked' : 'cli.updateUpToDate')

    return { text: `${toChatText(lines)}\n${verdict}` }
  }

  if (request.surface === CHANNEL_SURFACE) {
    // Shown here, so the private-chat reminder does not repeat it.
    await writeUpdateState(dataDir, { ...state, chatNotifiedAt: now }).catch(() => undefined)
  }

  return { text: toChatText(formatUpdateNotice(locale, state, UPGRADE_COMMAND)) }
}
