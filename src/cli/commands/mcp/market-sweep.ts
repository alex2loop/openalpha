import type { CliApp } from '@/cli/types'
import { liveDaemonPid } from '@/cli/daemon-guard'
import { formatErrForLog } from '@/core/security/credentials'
import { refreshMarketsInUse } from '@/trading/api'

/** With no daemon nothing refreshes market data, so a served session refreshes the markets in use as
 *  it starts and again whenever the profile is saved: a segment switched on or a name watched loads
 *  its market then, not on the next start. Saves during a pass coalesce into one more pass. The
 *  returned stop aborts the pass in flight and waits it out. */
export function startMarketSweeps(app: CliApp): () => Promise<void> {
  const abort = new AbortController()
  let queued = false
  let tail = Promise.resolve()

  const request = (): void => {
    if (queued || abort.signal.aborted) {
      return
    }

    queued = true
    tail = tail.then(async () => {
      queued = false

      if (!abort.signal.aborted) {
        await refreshWithoutDaemon(app, abort.signal)
      }
    })
  }

  const off = app.resolve('bus').on('profile_saved', request)

  request()

  return async (): Promise<void> => {
    off()
    abort.abort()
    await tail
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
