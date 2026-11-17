import type { CliApp } from '@/cli/types'
import { liveDaemonPid } from '@/cli/daemon-guard'
import { createPeriodicPass } from '@/core/periodic-pass'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_HOUR } from '@/core/utils/time'
import { refreshMarketsInUse } from '@/trading/api'

/** A pass skips every kind still fresh, so an hourly one costs little and picks up a session soon
 *  after it settles, in a server an app keeps open for days. */
const MARKET_SWEEP_INTERVAL_MS = MS_PER_HOUR

interface SweepOptions {
  /** A daemon keeps the markets it already uses fresh on its own schedule. */
  readonly skipWithDaemon: boolean
}

/** A served session refreshes the markets in use as it starts and every hour while no daemon does,
 *  and at once whenever the profile is saved. That last pass runs even beside a daemon, which lives
 *  in another process and never hears this one's save: a segment switched on or a name watched
 *  loads its market in seconds, while a market already refreshing in this process is joined rather
 *  than fetched twice. The returned stop aborts every pass and waits them out. */
export function startMarketSweeps(app: CliApp): () => Promise<void> {
  const abort = new AbortController()
  const savedPasses = new Set<Promise<void>>()
  const periodic = createPeriodicPass({
    everyMs: MARKET_SWEEP_INTERVAL_MS,
    pass: () => refreshQuietly(app, abort.signal, { skipWithDaemon: true }),
    // The sweep logs its own failure and never rejects.
    onError: () => undefined,
  })
  const off = app.resolve('bus').on('profile_saved', () => {
    const pass: Promise<void> = refreshQuietly(app, abort.signal, {
      skipWithDaemon: false,
    }).finally(() => savedPasses.delete(pass))

    savedPasses.add(pass)
  })

  return async (): Promise<void> => {
    off()
    abort.abort()
    await Promise.all([periodic.stop(), ...savedPasses])
  }
}

// Settles however the refresh ends: a failure is logged, never thrown, so the server keeps serving.
async function refreshQuietly(
  app: CliApp,
  signal: AbortSignal,
  options: SweepOptions
): Promise<void> {
  const logger = app.resolve('logger')

  try {
    if (options.skipWithDaemon && (await liveDaemonPid(app)) !== null) {
      return
    }

    await refreshMarketsInUse(
      { services: app.resolve('tradingServices'), logger, signal },
      (err: unknown) => {
        throw err
      }
    )
  } catch (err: unknown) {
    logger.warn('mcp.refresh_failed', { err: formatErrForLog(err) })
  }
}
