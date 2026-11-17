import type { CliApp } from '@/cli/types'
import { liveDaemonPid } from '@/cli/daemon-guard'
import { createPeriodicPass } from '@/core/periodic-pass'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_HOUR } from '@/core/utils/time'
import { refreshMarketsInUse } from '@/trading/api'

/** A pass skips every kind still fresh, so an hourly one costs little and picks up a session soon
 *  after it settles, in a server an app keeps open for days. */
const MARKET_SWEEP_INTERVAL_MS = MS_PER_HOUR

/** With no daemon nothing refreshes market data, so a served session refreshes the markets in use
 *  as it starts, every hour, and at once whenever the profile is saved: a segment switched on or a
 *  name watched loads its market without waiting out a long pass, since a market already refreshing
 *  is joined rather than fetched twice. The returned stop aborts every pass and waits them out. */
export function startMarketSweeps(app: CliApp): () => Promise<void> {
  const abort = new AbortController()
  const extraPasses = new Set<Promise<void>>()
  const sweep = (): Promise<void> => refreshWithoutDaemon(app, abort.signal)
  const periodic = createPeriodicPass({
    everyMs: MARKET_SWEEP_INTERVAL_MS,
    pass: sweep,
    // The sweep logs its own failure and never rejects.
    onError: () => undefined,
  })
  const off = app.resolve('bus').on('profile_saved', () => {
    const pass: Promise<void> = sweep().finally(() => extraPasses.delete(pass))

    extraPasses.add(pass)
  })

  return async (): Promise<void> => {
    off()
    abort.abort()
    await Promise.all([periodic.stop(), ...extraPasses])
  }
}

// Settles however the refresh ends: a failure is logged, never thrown, so the server keeps serving.
async function refreshWithoutDaemon(app: CliApp, signal: AbortSignal): Promise<void> {
  const logger = app.resolve('logger')

  try {
    if ((await liveDaemonPid(app)) !== null) {
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
