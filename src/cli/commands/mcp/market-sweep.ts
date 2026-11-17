import type { CliApp } from '@/cli/types'
import { liveDaemonPid } from '@/cli/daemon-guard'
import { formatErrForLog } from '@/core/security/credentials'
import { refreshMarketsInUse } from '@/trading/api'

/** With no daemon nothing refreshes market data, so a served session refreshes the markets in use
 *  once: a first start loads each market's list of names, a later one tops up what went stale. It
 *  settles however the refresh ends; a failure is logged, never thrown, so the server keeps serving. */
export async function refreshWithoutDaemon(app: CliApp, signal: AbortSignal): Promise<void> {
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
