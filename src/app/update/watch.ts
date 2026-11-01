import type { SelfUpgrade } from '@/app/update/install'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { App, TaskPassListener } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import {
  isUpdateCheckEnabled,
  newerVersionOf,
  readFreshUpdateState,
  type UpdateState,
} from '@/cli/api'
import { BRAND } from '@/core/brand'
import { reportPass } from '@/core/container'
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
const UPDATE_PASS = { name: 'update', everyMs: UPDATE_WATCH_INTERVAL_MS }

interface UpdateWatchOptions {
  readonly logger: Logger
  readonly upgrade: SelfUpgrade
  readonly onTaskPass: TaskPassListener
}

/** The newest release each log line has already said, and the last one tried, so an hourly tick
 *  repeats nothing. */
interface WatchMemory {
  loggedLatest: string | null
  skippedLatest: string | null
  attemptedLatest: string | null
}

interface TickOptions extends UpdateWatchOptions {
  readonly window: DailyWindow
  readonly memory: WatchMemory
  readonly signal: AbortSignal
}

interface AutoUpdateInput {
  readonly config: ResolvedConfig
  readonly state: UpdateState
  readonly latest: string
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
  const memory: WatchMemory = {
    loggedLatest: null,
    skippedLatest: null,
    attemptedLatest: null,
  }
  let inFlight: Promise<void> | null = null

  const check = (): void => {
    if (inFlight !== null) {
      return
    }

    inFlight = reportPass(options.onTaskPass, UPDATE_PASS, () =>
      runUpdateCheck(app, { ...options, window, memory, signal: controller.signal })
    )
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

  if (!isUpdateCheckEnabled(config)) {
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

  if (isAutoUpdateDue({ config, state, latest, window: options.window, now })) {
    await installWhenSessionsClosed(app, options, { latest, now })
  }
}

/** One attempt per release per daemon run: a release that fails to download or install waits for
 *  the operator's `/upgrade confirm` instead of retrying every hour. The session is read last, only
 *  for a release that is otherwise due, so the book is not read on every tick. */
async function installWhenSessionsClosed(
  app: App,
  options: TickOptions,
  due: { readonly latest: string; readonly now: number }
): Promise<void> {
  const { memory, logger, signal } = options
  const { latest } = due

  if (memory.attemptedLatest === latest) {
    return
  }

  const sessionOpen = await isSessionOpen(app, options, due.now)

  // Open now, so the next hourly tick in the window asks again.
  if (signal.aborted || sessionOpen) {
    return
  }

  const started = await options.upgrade.start({ latest })

  if (started === 'started' || started === 'failed') {
    memory.attemptedLatest = latest
  }

  // Waiting never changes it, so it is said once per release.
  if (started === 'foreground' && memory.skippedLatest !== latest) {
    memory.skippedLatest = latest
    logger.info('update.auto_skipped', { latest })
  }

  if (started === 'started') {
    logger.info('update.auto_started', { latest })
  }
}

/** When in doubt, a session is open: an unreadable book never installs. A tick cut short by
 *  shutdown reads as open too, so nothing starts while the daemon goes down. */
async function isSessionOpen(app: App, options: TickOptions, now: number): Promise<boolean> {
  try {
    return await app.resolve('tradingServices').isSessionOpen(now, options.signal)
  } catch (err: unknown) {
    if (!options.signal.aborted) {
      options.logger.warn('update.session_check_failed', { err: formatErrForLog(err) })
    }

    return true
  }
}

/** Everything but the session, which costs a read of the book and is asked only after this. */
function isAutoUpdateDue(input: AutoUpdateInput): boolean {
  const { config, state, latest, now } = input

  return (
    config.update.auto &&
    isPatchRelease(latest, BRAND.version) &&
    latest !== state.rolledBackVersion &&
    isWithinDailyWindow(now, input.window)
  )
}
