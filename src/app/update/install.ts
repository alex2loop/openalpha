import type { DeliveryHub } from '@/app/delivery'
import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { DeliveryTarget } from '@/scheduler/api'
import {
  formatInstalledNotice,
  isBackgroundLaunch,
  type PendingUpgrade,
  readUpdateState,
  spawnUpgradeProcess,
  toChatText,
  type UpdateState,
  writeUpdateState,
} from '@/cli/api'
import { UPGRADE_COMMAND_NAME } from '@/commands/api'
import { BRAND } from '@/core/brand'
import { channelId } from '@/core/channels'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { compareVersions } from '@/core/utils/version'
import { t } from '@/i18n'

// Longer than the upgrade's own 5-minute download timeout plus the 90-second daemon start.
const PENDING_UPGRADE_MS = 10 * MS_PER_MINUTE
const CHAT_UPGRADE_COMMAND = `/${UPGRADE_COMMAND_NAME}`

/** `busy`: an upgrade is already under way. `working`: the bot is mid-run, and a restart would cut
 *  it off. */
export type UpgradeStart = 'started' | 'busy' | 'working' | 'foreground' | 'failed'

interface UpgradeRequest {
  readonly latest: string
  readonly target?: DeliveryTarget
}

export interface SelfUpgrade {
  start(request: UpgradeRequest): Promise<UpgradeStart>
  announceOutcome(): Promise<void>
}

interface UpgradeParts {
  readonly app: App
  readonly delivery: DeliveryHub
  readonly logger: Logger
}

export function createSelfUpgrade(app: App, delivery: DeliveryHub): SelfUpgrade {
  const parts: UpgradeParts = { app, delivery, logger: app.resolve('logger') }
  // Set before the first await: two taps, or a re-delivered inbox message, never both pass the
  // pending check below.
  let starting = false

  return {
    async start(request): Promise<UpgradeStart> {
      if (starting) {
        return 'busy'
      }

      starting = true

      try {
        return await startUpgrade(parts, request)
      } finally {
        starting = false
      }
    },
    announceOutcome: () => announceUpgradeOutcome(parts),
  }
}

async function startUpgrade(parts: UpgradeParts, request: UpgradeRequest): Promise<UpgradeStart> {
  const { app, delivery } = parts

  // A daemon in a terminal or under a service is not ours to restart.
  if (!isBackgroundLaunch()) {
    return 'foreground'
  }

  // A restart drains for up to 30 s and then aborts: an answer, a research run or a tool approval
  // waiting for its tap would be lost.
  if (app.resolve('runRegistry').active().length > 0 || delivery.isWorking()) {
    return 'working'
  }

  const now = Date.now()
  const state = await readUpdateState(app.config.paths.dataDir)

  if (isPending(state.pendingUpgrade, now)) {
    return 'busy'
  }

  return await spawnUpgrade(parts, { request, state, now })
}

/** The pending record goes down before the process starts, so the next daemon knows whom to tell.
 *  A record that cannot be written, or a process that cannot start, is a failed start. */
async function spawnUpgrade(
  parts: UpgradeParts,
  begin: { readonly request: UpgradeRequest; readonly state: UpdateState; readonly now: number }
): Promise<UpgradeStart> {
  const { app, delivery, logger } = parts
  const { dataDir } = app.config.paths
  const target = begin.request.target ?? delivery.defaultRecipient()
  const pendingUpgrade: PendingUpgrade = {
    from: BRAND.version,
    to: begin.request.latest,
    requestedAt: begin.now,
    ...(target === undefined ? {} : { target: { channel: target.channel, chatId: target.chatId } }),
  }

  try {
    await writeUpdateState(dataDir, { ...begin.state, pendingUpgrade })

    const child = await spawnUpgradeProcess(app)

    child.exited
      .then((code) => reportUpgradeExit(parts, { code, target, latest: begin.request.latest }))
      .catch((err: unknown) => {
        logger.warn('update.install_report_failed', { err: formatErrForLog(err) })
      })

    return 'started'
  } catch (err: unknown) {
    logger.error('update.install_start_failed', { err: formatErrForLog(err) })
    await clearPendingUpgrade(dataDir).catch(() => {
      // The record expires on its own after PENDING_UPGRADE_MS.
    })

    return 'failed'
  }
}

/** A daemon the upgrade replaced reports nothing here: the new one does, once it is ready. Any exit
 *  while this daemon still runs means it is still on its own release. */
async function reportUpgradeExit(
  parts: UpgradeParts,
  exit: {
    readonly code: number
    readonly target: DeliveryTarget | undefined
    readonly latest: string
  }
): Promise<void> {
  const { app, logger } = parts
  const locale = app.config.locale.language
  const current = `v${BRAND.version}`

  if (app.signal.aborted) {
    return
  }

  // A failed install is remembered like a rollback, so auto update does not try the same release
  // again every night; an exit that changed nothing leaves it free to.
  await clearPendingUpgrade(app.config.paths.dataDir, exit.code === 0 ? undefined : exit.latest)

  if (exit.code !== 0) {
    logger.error('update.install_failed', { code: exit.code })
  }

  const text =
    exit.code === 0
      ? t(locale, 'cli.upgradeNotSwitched', { current, command: CHAT_UPGRADE_COMMAND })
      : t(locale, 'cli.upgradeFailed', { current })

  await sendToTarget(parts, { target: exit.target, text })
}

async function announceUpgradeOutcome(parts: UpgradeParts): Promise<void> {
  const { app, logger } = parts
  const { dataDir } = app.config.paths
  const state = await readUpdateState(dataDir)
  const pending = state.pendingUpgrade

  if (pending === null) {
    return
  }

  // Too old to be this run's upgrade: the daemon restarted for some other reason.
  const current = isPending(pending, Date.now())
  const failed = current && !isUpgradedFrom(pending)

  // Cleared before sending, so a crash never repeats the message. A failed install is remembered
  // like a rollback, so auto update does not try the same release again tonight.
  await clearPendingUpgrade(dataDir, failed ? pending.to : undefined)

  if (!current) {
    return
  }

  const result = await sendToTarget(parts, {
    target: toDeliveryTarget(pending),
    text: toOutcomeText(app.config.locale.language, state, pending),
  })

  if (result !== 'accepted') {
    logger.warn('update.announce_failed', { result })

    return
  }

  // Whatever the outcome, the operator now knows which release runs.
  const fresh = await readUpdateState(dataDir)

  await writeUpdateState(dataDir, { ...fresh, chatAnnouncedVersion: BRAND.version })
}

/** Newer than where it started is a success even when a later release than the one asked for came
 *  out in between; the upgrade always takes the newest. */
function toOutcomeText(locale: Locale, state: UpdateState, pending: PendingUpgrade): string {
  if (isUpgradedFrom(pending)) {
    return toChatText(formatInstalledNotice(locale, state))
  }

  const failed = state.rolledBackVersion

  if (failed !== null && compareVersions(failed, pending.from) > 0) {
    return t(locale, 'cli.upgradeRolledBack', {
      brand: BRAND.display,
      failed: `v${failed}`,
      current: `v${BRAND.version}`,
    })
  }

  // The download or the swap failed, and the old binary was started again.
  return t(locale, 'cli.upgradeFailed', { current: `v${BRAND.version}` })
}

async function sendToTarget(
  parts: UpgradeParts,
  message: { readonly target: DeliveryTarget | undefined; readonly text: string }
): Promise<'accepted' | 'unavailable' | 'aborted'> {
  const { app, delivery } = parts
  const to = message.target ?? delivery.defaultRecipient()

  if (to === undefined) {
    return 'unavailable'
  }

  return await delivery.sendAcknowledged(to, { text: message.text }, app.signal)
}

function toDeliveryTarget(pending: PendingUpgrade): DeliveryTarget | undefined {
  if (pending.target === undefined) {
    return undefined
  }

  return { channel: channelId(pending.target.channel), chatId: pending.target.chatId }
}

function isUpgradedFrom(pending: PendingUpgrade): boolean {
  return compareVersions(BRAND.version, pending.from) > 0
}

function isPending(pending: PendingUpgrade | null, now: number): boolean {
  return pending !== null && now - pending.requestedAt < PENDING_UPGRADE_MS
}

async function clearPendingUpgrade(dataDir: string, failedVersion?: string): Promise<void> {
  const state = await readUpdateState(dataDir)

  await writeUpdateState(dataDir, {
    ...state,
    pendingUpgrade: null,
    ...(failedVersion === undefined ? {} : { rolledBackVersion: failedVersion }),
  })
}
