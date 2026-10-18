import type { SelfUpgrade, UpgradeStart } from '@/app/update/install'
import type { OperatorNotices } from '@/channels/api'
import type { ReleaseUpdates, UpgradeReply, UpgradeRequest } from '@/commands/api'
import type { App } from '@/core/container'
import type { Locale } from '@/core/types/locale'
import {
  formatInstalledNotice,
  formatUpdateNotice,
  isUpdateCheckEnabled,
  newerVersionOf,
  patchUpdateState,
  readFreshUpdateState,
  takeChatNotice,
  toChatText,
  UPGRADE_COMMAND,
  type UpdateState,
} from '@/cli/api'
import { UPGRADE_CONFIRM_COMMAND } from '@/commands/api'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

const CHANNEL_SURFACE = 'channel'

export function createReleaseUpdates(app: App, upgrade: SelfUpgrade): ReleaseUpdates {
  return {
    describe: (request) => describeRelease(app, request),
    install: (request) => installRelease(app, { request, upgrade }),
  }
}

/** The private-chat reminder, read from the cache the update watch keeps fresh. */
export function createOperatorNotices(app: App): OperatorNotices {
  return { take: (chat) => takeChatNotice(app.config, chat) }
}

async function describeRelease(app: App, request: UpgradeRequest): Promise<UpgradeReply> {
  const { locale } = request
  const unavailable = explainUnavailable(app, locale)

  if (unavailable !== null) {
    return { text: unavailable }
  }

  const now = Date.now()
  const state = await readFreshUpdateState(app.config.paths.dataDir, {
    now,
    signal: request.signal,
  })

  if (newerVersionOf(state) === null) {
    return { text: toUpToDateText(locale, state) }
  }

  const isChannel = request.surface === CHANNEL_SURFACE
  const shown = isChannel ? { chatNotifiedAt: now } : { notifiedAt: now }

  // Shown here, so the reminder on the same surface does not repeat it.
  await patchUpdateState(app.config.paths.dataDir, shown).catch(() => {
    // A cache that cannot be written only lets the reminder repeat this once.
  })

  if (!isChannel) {
    return { text: toChatText(formatUpdateNotice(locale, state, UPGRADE_COMMAND)) }
  }

  return {
    text: toChatText(formatUpdateNotice(locale, state, UPGRADE_CONFIRM_COMMAND)),
    confirmLabel: t(locale, 'cli.upgradeConfirmLabel'),
  }
}

async function installRelease(
  app: App,
  options: { readonly request: UpgradeRequest; readonly upgrade: SelfUpgrade }
): Promise<UpgradeReply> {
  const { request, upgrade } = options
  const { locale } = request

  if (request.surface !== CHANNEL_SURFACE) {
    return { text: t(locale, 'cli.upgradeFromTerminal', { command: UPGRADE_COMMAND }) }
  }

  const unavailable = explainUnavailable(app, locale)

  if (unavailable !== null) {
    return { text: unavailable }
  }

  const state = await readFreshUpdateState(app.config.paths.dataDir, {
    now: Date.now(),
    signal: request.signal,
  })
  const latest = newerVersionOf(state)

  if (latest === null) {
    return { text: t(locale, 'cli.updateUpToDate') }
  }

  const started = await upgrade.start({ latest, target: request.target })

  return { text: toStartText(locale, started, latest) }
}

/** Why there is nothing to show: checks off, or a source checkout that updates with git. */
function explainUnavailable(app: App, locale: Locale): string | null {
  if (isUpdateCheckEnabled(app.config)) {
    return null
  }

  return t(locale, app.config.update.check ? 'cli.upgradeSourceCheckout' : 'cli.updateCheckOff')
}

function toUpToDateText(locale: Locale, state: UpdateState): string {
  const verdict = t(locale, state.failed ? 'cli.updateUnchecked' : 'cli.updateUpToDate')

  return `${toChatText(formatInstalledNotice(locale, state, { upgraded: false }))}\n${verdict}`
}

function toStartText(locale: Locale, started: UpgradeStart, latest: string): string {
  switch (started) {
    case 'foreground':
      return t(locale, 'cli.upgradeNeedsTerminal', {
        brand: BRAND.display,
        command: UPGRADE_COMMAND,
      })
    case 'busy':
      return t(locale, 'cli.upgradeInProgress')
    case 'working':
      return t(locale, 'cli.upgradeWhileWorking', { command: UPGRADE_CONFIRM_COMMAND })
    case 'failed':
      return t(locale, 'cli.upgradeFailed', { current: `v${BRAND.version}` })
    case 'started':
      return t(locale, 'cli.upgradeRestarting', { latest: `v${latest}` })
    default:
      return started satisfies never
  }
}
