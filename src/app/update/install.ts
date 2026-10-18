import { join } from 'node:path'

import type { DeliveryHub } from '@/app/delivery'
import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { DeliveryTarget } from '@/scheduler/api'
import {
  buildSelfArgv,
  formatInstalledNotice,
  getEnv,
  isBackgroundLaunch,
  type PendingUpgrade,
  readUpdateState,
  spawnDetached,
  toChatText,
  type UpdateState,
  writeUpdateState,
} from '@/cli/api'
import { UPGRADE_COMMAND_NAME } from '@/commands/api'
import { BRAND } from '@/core/brand'
import { channelId } from '@/core/channels'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { t } from '@/i18n'

// Longer than the upgrade's own 5-minute download timeout plus the 90-second daemon start.
const PENDING_UPGRADE_MS = 10 * MS_PER_MINUTE
const UPGRADE_STDOUT_LOG = 'upgrade.stdout.log'
const UPGRADE_STDERR_LOG = 'upgrade.stderr.log'

/** `busy`: an upgrade is already under way. `working`: the bot is mid-run, and a restart would cut
 *  it off. */
export type UpgradeStart = 'started' | 'busy' | 'working' | 'foreground' | 'failed'

export interface SelfUpgrade {
  start(request: {
    readonly latest: string
    readonly target?: DeliveryTarget
  }): Promise<UpgradeStart>
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
  request: { readonly latest: string; readonly target?: DeliveryTarget }
): Promise<UpgradeStart> {
  const { app, delivery } = parts

  // A daemon in a terminal or under a service is not ours to restart.
  if (!isBackgroundLaunch()) {
    return 'foreground'
  }

  // A restart drains for up to 30 s and then aborts: an answer, a research run or a tool approval
  // waiting for its tap would be lost.
  if (app.resolve('runRegistry').active().length > 0 || delivery.isBusy()) {
    return 'working'
  }

  const { dataDir } = app.config.paths
  const now = Date.now()
  const state = await readUpdateState(dataDir)

  if (isPending(state.pendingUpgrade, now)) {
    return 'busy'
  }

  const target = request.target ?? delivery.defaultRecipient()
  const pendingUpgrade: PendingUpgrade = {
    from: BRAND.version,
    to: request.latest,
    requestedAt: now,
    ...(target === undefined ? {} : { target: { channel: target.channel, chatId: target.chatId } }),
  }

  await writeUpdateState(dataDir, { ...state, pendingUpgrade })

  return await spawnUpgrade(parts, { target, latest: request.latest })
}

async function spawnUpgrade(
  parts: UpgradeParts,
  request: { readonly target: DeliveryTarget | undefined; readonly latest: string }
): Promise<UpgradeStart> {
  const { app, logger } = parts
  const { dataDir } = app.config.paths
  const hasConfig = await Bun.file(app.configPath).exists()

  try {
    const child = spawnDetached({
      argv: buildSelfArgv({
        dataDir,
        configPath: hasConfig ? app.configPath : undefined,
        tail: [UPGRADE_COMMAND_NAME],
      }),
      stdoutPath: join(dataDir, UPGRADE_STDOUT_LOG),
      stderrPath: join(dataDir, UPGRADE_STDERR_LOG),
      env: getEnv(),
    })

    child.exited
      .then((code) => reportUpgradeExit(parts, { code, ...request }))
      .catch((err: unknown) => {
        logger.warn('update.install_report_failed', { err: formatErrForLog(err) })
      })

    return 'started'
  } catch (err: unknown) {
    logger.error('update.install_spawn_failed', { err: formatErrForLog(err) })
    await clearPendingUpgrade(dataDir)

    return 'failed'
  }
}

/** A daemon the upgrade replaced reports nothing here: the new one does, from its first check. */
async function reportUpgradeExit(
  parts: UpgradeParts,
  exit: {
    readonly code: number
    readonly target: DeliveryTarget | undefined
    readonly latest: string
  }
): Promise<void> {
  const { app, logger } = parts

  if (app.signal.aborted) {
    return
  }

  if (exit.code === 0) {
    await clearPendingUpgrade(app.config.paths.dataDir)

    return
  }

  // Auto update must not try this release again on its own: a failure that repeats would restart
  // the bot every night.
  await clearPendingUpgrade(app.config.paths.dataDir, exit.latest)

  logger.error('update.install_failed', { code: exit.code })
  await sendToTarget(parts, {
    target: exit.target,
    text: t(app.config.locale.language, 'cli.upgradeFailed', { current: `v${BRAND.version}` }),
  })
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
  const failed = current && BRAND.version !== pending.to

  // Cleared before sending, so a crash never repeats the message. A failed install is remembered
  // like a rollback, so auto update does not try the same release again tonight.
  await clearPendingUpgrade(dataDir, failed ? pending.to : undefined)

  if (!current) {
    return
  }

  const target =
    pending.target === undefined
      ? undefined
      : { channel: channelId(pending.target.channel), chatId: pending.target.chatId }
  const result = await sendToTarget(parts, {
    target,
    text: toOutcomeText(app.config.locale.language, state, pending),
  })

  if (result !== 'accepted') {
    logger.warn('update.announce_failed', { result })

    return
  }

  if (BRAND.version === pending.to) {
    const fresh = await readUpdateState(dataDir)

    await writeUpdateState(dataDir, { ...fresh, chatAnnouncedVersion: BRAND.version })
  }
}

function toOutcomeText(locale: Locale, state: UpdateState, pending: PendingUpgrade): string {
  if (BRAND.version === pending.to) {
    return toChatText(formatInstalledNotice(locale, state))
  }

  if (state.rolledBackVersion === pending.to) {
    return t(locale, 'cli.upgradeRolledBack', {
      brand: BRAND.display,
      failed: `v${pending.to}`,
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
