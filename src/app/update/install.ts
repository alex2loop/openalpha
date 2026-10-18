import type { DeliveryHub } from '@/app/delivery'
import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { DeliveryTarget } from '@/scheduler/api'
import {
  formatInstalledNotice,
  isBackgroundLaunch,
  type PendingUpgrade,
  patchUpdateState,
  readUpdateState,
  spawnUpgradeProcess,
  toChatText,
  type UpdateState,
} from '@/cli/api'
import { UPGRADE_CHAT_COMMAND } from '@/commands/api'
import { BRAND } from '@/core/brand'
import { channelId } from '@/core/channels'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { compareVersions } from '@/core/utils/version'
import { t } from '@/i18n'

// Longer than the upgrade's own 5-minute download timeout plus the 90-second daemon start.
const PENDING_UPGRADE_MS = 10 * MS_PER_MINUTE

/** `busy`: an upgrade is already under way. `working`: the bot is mid-run, and a restart would cut
 *  it off. */
export type UpgradeStart = 'started' | 'busy' | 'working' | 'foreground' | 'failed'

interface UpgradeStartRequest {
  readonly latest: string
  readonly target?: DeliveryTarget
}

export interface SelfUpgrade {
  start(request: UpgradeStartRequest): Promise<UpgradeStart>
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

async function startUpgrade(
  parts: UpgradeParts,
  request: UpgradeStartRequest
): Promise<UpgradeStart> {
  const { app } = parts

  // A daemon in a terminal or under a service is not ours to restart.
  if (!isBackgroundLaunch()) {
    return 'foreground'
  }

  if (isWorking(parts)) {
    return 'working'
  }

  const now = Date.now()
  const state = await readUpdateState(app.config.paths.dataDir)

  if (isPending(state.pendingUpgrade, now)) {
    return 'busy'
  }

  return await spawnUpgrade(parts, { ...request, requestedAt: now })
}

/** A restart drains for up to 30 s and then aborts: an answer, a research run, a tool approval
 *  waiting for its tap, or a trading pass such as a brief's debate would be lost. */
function isWorking(parts: UpgradeParts): boolean {
  const { app, delivery } = parts

  return (
    app.resolve('runRegistry').active().length > 0 ||
    delivery.isWorking() ||
    app.resolve('tradingServices').daemonTasks.some((task) => task.isWorking?.() === true)
  )
}

/** The pending record goes down before the process starts, so the next daemon knows whom to tell.
 *  A record that cannot be written, or a process that cannot start, is a failed start. */
async function spawnUpgrade(
  parts: UpgradeParts,
  request: UpgradeStartRequest & { readonly requestedAt: number }
): Promise<UpgradeStart> {
  const { app, delivery, logger } = parts
  const { dataDir } = app.config.paths
  const target = request.target ?? delivery.defaultRecipient()
  const pendingUpgrade: PendingUpgrade = {
    from: BRAND.version,
    to: request.latest,
    requestedAt: request.requestedAt,
    ...(target === undefined ? {} : { target: { channel: target.channel, chatId: target.chatId } }),
  }

  // Shutting down: the process would restart a daemon that is on its way out.
  if (app.signal.aborted) {
    return 'failed'
  }

  try {
    await patchUpdateState(dataDir, { pendingUpgrade })

    const child = await spawnUpgradeProcess(app)

    child.exited
      .then((code) => reportUpgradeExit(parts, { code, target, latest: request.latest }))
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
  await clearPendingUpgrade(
    app.config.paths.dataDir,
    exit.code === 0 ? {} : { failedVersion: exit.latest }
  )

  if (exit.code !== 0) {
    logger.error('update.install_failed', { code: exit.code })
  }

  const text =
    exit.code === 0
      ? t(locale, 'cli.upgradeNotSwitched', { current, command: UPGRADE_CHAT_COMMAND })
      : t(locale, 'cli.upgradeFailed', { current })

  await sendOutcome(parts, { target: exit.target, text })
}

/** Cleared before sending, so a crash never repeats the message. The chat is marked as told in the
 *  same write, so an operator message arriving meanwhile does not get the installed notice twice. */
async function announceUpgradeOutcome(parts: UpgradeParts): Promise<void> {
  const { app, delivery } = parts
  const { dataDir } = app.config.paths
  const state = await readUpdateState(dataDir)
  const pending = state.pendingUpgrade

  if (pending === null) {
    return
  }

  // Too old to be this run's upgrade: the daemon restarted for some other reason.
  const current = isPending(pending, Date.now())
  const failed = current && !isUpgradedFrom(pending)
  const target = toDeliveryTarget(pending) ?? delivery.defaultRecipient()

  await clearPendingUpgrade(dataDir, {
    told: current && target !== undefined,
    ...(failed ? { failedVersion: pending.to } : {}),
  })

  if (!current) {
    return
  }

  await sendOutcome(parts, {
    target,
    text: toOutcomeText(app.config.locale.language, state, pending),
  })
}

/** Newer than where it started is a success even when a later release than the one asked for came
 *  out in between; the upgrade always takes the newest. */
function toOutcomeText(locale: Locale, state: UpdateState, pending: PendingUpgrade): string {
  if (isUpgradedFrom(pending)) {
    return toChatText(formatInstalledNotice(locale, state, { upgraded: true }))
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

/** No channel and no paired chat is not a failure: the terminal says which release runs. */
async function sendOutcome(
  parts: UpgradeParts,
  message: { readonly target: DeliveryTarget | undefined; readonly text: string }
): Promise<void> {
  const { app, delivery, logger } = parts

  if (message.target === undefined) {
    return
  }

  const result = await delivery.sendAcknowledged(message.target, { text: message.text }, app.signal)

  if (result !== 'accepted') {
    logger.warn('update.announce_failed', { result })
  }
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

/** The newer of the two, so a rollback the upgrade recorded for a later release is never lowered. */
function laterOf(recorded: string | null, failed: string): string {
  return recorded !== null && compareVersions(recorded, failed) >= 0 ? recorded : failed
}

/** `failedVersion` is kept from auto update like a rollback. */
async function clearPendingUpgrade(
  dataDir: string,
  close: { readonly failedVersion?: string; readonly told?: boolean } = {}
): Promise<void> {
  const { failedVersion, told } = close

  await patchUpdateState(dataDir, (state) => ({
    pendingUpgrade: null,
    ...(failedVersion === undefined
      ? {}
      : { rolledBackVersion: laterOf(state.rolledBackVersion, failedVersion) }),
    ...(told === true ? { chatAnnouncedVersion: BRAND.version } : {}),
  }))
}
