import type { App, TaskPass, TaskPassListener } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { requestPersistence } from '@/app/browser/persistence'
import { refreshMarketsInUse } from '@/app/market-sweep'
import {
  RETENTION_INTERVAL_MS,
  RETENTION_PASS,
  runPortableRetention,
} from '@/app/portable-retention'
import { notifyPass, reportPass } from '@/core/container'
import { createPeriodicPass } from '@/core/periodic-pass'
import { formatErrForLog } from '@/core/security/credentials'
import { StorageFullError } from '@/persistence/api'

const HISTORY_FULL: NonNullable<TaskPass['error']> = { key: 'ui.office.edition.history.full' }
/** The refresh reports under the name the daemon's own pass uses, so the page's task list reads the
 *  same on both editions; a pass that found no room says so. */
const REFRESH_PASS = {
  name: 'trading.refresh',
  everyMs: RETENTION_INTERVAL_MS,
  failure: (err: unknown) => (err instanceof StorageFullError ? HISTORY_FULL : undefined),
}
/** Works only while a first refresh is loading the history the factor board reads. */
const HISTORY_TASK = 'browser.history'

interface UpkeepContext {
  readonly app: App
  readonly logger: Logger
  /** Set when a write found no room: the refresh waits, the sweep goes on because deleting is what
   *  makes room, and a sweep that deleted rows lets the refresh try again. */
  storageFull: boolean
}

/** What the daemon's loops do while it runs, done while the tab is open: a refresh of the markets in
 *  use, then the database sweep, now and every few hours. The first refresh of an empty profile is
 *  the history backfill: the market writes the history a window at a time, and the sweep waits for
 *  it. The returned stop ends the schedule and waits out the pass in flight (the app's own signal
 *  cuts a long refresh short first). */
export function startBrowserUpkeep(app: App, logger: Logger): () => Promise<void> {
  const context: UpkeepContext = { app, logger, storageFull: false }
  const persistence = requestPersistence(app, logger)
  const stopPasses = createPeriodicPass({
    everyMs: RETENTION_INTERVAL_MS,
    pass: () => runUpkeepPass(context),
    onError: (err) => {
      logger.warn('browser.upkeep_failed', { err: formatErrForLog(err) })
    },
  })

  return async () => {
    await stopPasses()
    await persistence
  }
}

async function runUpkeepPass(context: UpkeepContext): Promise<void> {
  const { app, logger } = context
  const listener = app.resolve('taskStatus').listener

  if (!context.storageFull) {
    await refreshUnlessFull(context, listener)
  }

  // A shutdown that cut the refresh short has no database left to sweep.
  if (!app.signal.aborted) {
    const freed = await reportPass(listener, RETENTION_PASS, () =>
      runPortableRetention(app, logger)
    )

    context.storageFull &&= freed === 0
  }
}

// The pass already reported why it ended, and the sweep that follows is what makes room.
async function refreshUnlessFull(
  context: UpkeepContext,
  listener: TaskPassListener
): Promise<void> {
  try {
    await reportPass(listener, REFRESH_PASS, () => refreshInUse(context, listener))
  } catch (err: unknown) {
    if (!(err instanceof StorageFullError)) {
      throw err
    }
  }
}

// A profile with no refresh on record is loading history; the task reads as working until the pass
// ends, and carries the reason if it ended because the device is out of room.
async function refreshInUse(context: UpkeepContext, listener: TaskPassListener): Promise<void> {
  const loading = await isHistoryLoading(context.app)
  const at = Date.now()
  let error: TaskPass['error']

  if (loading) {
    notifyPass(listener, { name: HISTORY_TASK, phase: 'start', at })
  }

  try {
    await refreshMarketsInUse(
      { app: context.app, logger: context.logger, signal: context.app.signal },
      (err) => {
        if (err instanceof StorageFullError) {
          throw err
        }

        context.logger.warn('browser.refresh_failed', { err: formatErrForLog(err) })
      }
    )
  } catch (err: unknown) {
    if (err instanceof StorageFullError) {
      context.storageFull = true
      error = HISTORY_FULL
      context.logger.warn('browser.history_storage_full', { err: formatErrForLog(err) })
    }

    throw err
  } finally {
    if (loading) {
      notifyPass(listener, {
        name: HISTORY_TASK,
        phase: 'end',
        at,
        ...(error === undefined ? {} : { error }),
      })
    }
  }
}

/** True while no market in use has ever completed a refresh on this device. */
async function isHistoryLoading(app: App): Promise<boolean> {
  const { signal } = app
  const markets = await app.resolve('tradingServices').marketsInUse(signal)
  const store = app.resolve('tradingStores').marketData
  const attempts = await Promise.all(
    [...markets].map((market) => store.listRefreshAttempts({ market, signal }))
  )

  return attempts.every((stored) => stored.length === 0)
}
