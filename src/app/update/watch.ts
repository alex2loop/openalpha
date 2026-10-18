import type { SelfUpgrade } from '@/app/update/install'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import {
  isUpdateCheckEnabled,
  newerVersionOf,
  readFreshUpdateState,
  type UpdateState,
} from '@/cli/api'
import { BRAND } from '@/core/brand'
import { formatErrForLog } from '@/core/security/credentials'
import {
  type DailyWindow,
  isWithinDailyWindow,
  MS_PER_HOUR,
  parseDailyWindow,
} from '@/core/utils/time'
import { isPatchRelease } from '@/core/utils/version'

// Network reads stay at twice a day: each tick goes through `readFreshUpdateState`.
const UPDATE_WATCH_INTERVAL_MS = MS_PER_HOUR
// The operator's night on `[locale] timezone`, wide enough that every zone keeps at least two hourly
// ticks outside the sessions of the markets in use: a VN book read from Europe or a UTC host
// installs at 00:00-02:00, from the US at 03:00-06:00.
const AUTO_UPDATE_WINDOW = '00:00-06:00'

interface UpdateWatchOptions {
  readonly logger: Logger
  readonly upgrade: SelfUpgrade
}

/** The newest release each log line has already said, so an hourly tick repeats nothing. */
interface WatchMemory {
  loggedLatest: string | null
  skippedLatest: string | null
  blockedLatest: string | null
}

interface TickOptions extends UpdateWatchOptions {
  readonly window: DailyWindow
  readonly memory: WatchMemory
  readonly signal: AbortSignal
}

interface AutoUpdateInput {
  readonly config: ResolvedConfig
  readonly enabled: boolean
  readonly sessionOpen: boolean
  readonly state: UpdateState
  readonly window: DailyWindow
  readonly now: number
}

/** Logs a newer release as it appears and installs patch releases by itself when asked to. A channel
 *  hears of a release only at the foot of the morning brief (`readUpdateLine`) and in the
 *  operator's private chat: alerts carry signals, not maintenance notices. */
export function startUpdateWatch(app: App, options: UpdateWatchOptions): () => Promise<void> {
  const { logger } = options
  const controller = new AbortController()
  const window = parseDailyWindow(AUTO_UPDATE_WINDOW, app.config.locale.timezone)
  const memory: WatchMemory = { loggedLatest: null, skippedLatest: null, blockedLatest: null }
  let inFlight: Promise<void> | null = null

  const check = (): void => {
    if (inFlight !== null) {
      return
    }

    inFlight = runUpdateCheck(app, { ...options, window, memory, signal: controller.signal })
      .catch((err: unknown) => {
        logger.warn('update.check_failed', { err: formatErrForLog(err) })
      })
      .finally(() => {
        inFlight = null
      })
  }

  const timer = setInterval(check, UPDATE_WATCH_INTERVAL_MS)
  timer.unref()
  check()

  return async () => {
    clearInterval(timer)
    controller.abort()

    if (inFlight !== null) {
      await inFlight
    }
  }
}

async function runUpdateCheck(app: App, options: TickOptions): Promise<void> {
  const { config } = app
  const enabled = await isUpdateCheckEnabled(config)

  if (!enabled) {
    return
  }

  const now = Date.now()
  const state = await readFreshUpdateState(config.paths.dataDir, { now, signal: options.signal })
  const latest = newerVersionOf(state)

  if (latest === null) {
    return
  }

  if (latest !== options.memory.loggedLatest) {
    options.memory.loggedLatest = latest
    options.logger.info('update.available', { current: BRAND.version, latest })
  }

  if (config.update.auto) {
    await installWhenDue(app, options, { config, enabled, state, now })
  }
}

async function installWhenDue(
  app: App,
  options: TickOptions,
  tick: Pick<AutoUpdateInput, 'config' | 'enabled' | 'state' | 'now'>
): Promise<void> {
  const { memory, logger, window } = options
  const latest = newerVersionOf(tick.state)
  const sessionOpen = await readSessionOpen(app, options, tick.now)
  const input: AutoUpdateInput = { ...tick, sessionOpen, window }

  // Every condition but the session decides whether a blocked night is worth a line.
  if (latest === null || !isAutoUpdateDue({ ...input, sessionOpen: false })) {
    return
  }

  if (sessionOpen) {
    if (memory.blockedLatest !== latest) {
      memory.blockedLatest = latest
      logger.info('update.auto_blocked', { latest })
    }

    return
  }

  const started = await options.upgrade.start({ latest })

  if (started === 'foreground' && memory.skippedLatest !== latest) {
    memory.skippedLatest = latest
    logger.info('update.auto_skipped', { latest })
  }

  if (started === 'started') {
    logger.info('update.auto_started', { latest })
  }
}

/** When in doubt, a session is open: an unreadable book never installs. */
async function readSessionOpen(app: App, options: TickOptions, now: number): Promise<boolean> {
  try {
    return await app.resolve('tradingServices').isSessionOpen(now, options.signal)
  } catch (err: unknown) {
    options.logger.warn('update.session_check_failed', { err: formatErrForLog(err) })

    return true
  }
}

function isAutoUpdateDue(input: AutoUpdateInput): boolean {
  const { config, state, now } = input
  const latest = newerVersionOf(state)

  return (
    input.enabled &&
    config.update.auto &&
    latest !== null &&
    isPatchRelease(latest, BRAND.version) &&
    latest !== state.rolledBackVersion &&
    isWithinDailyWindow(now, input.window) &&
    !input.sessionOpen
  )
}
