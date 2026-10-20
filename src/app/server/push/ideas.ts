import type { WireEvent } from '@/app/server/wire/events'
import type { App } from '@/core/container'
import type { StoredSuggestion } from '@/trading/api'
import { APP_SOURCE } from '@/app/server/channel'
import { broadcast } from '@/app/server/ws/socket'
import { formatErrForLog } from '@/core/security/credentials'

const IDEA_POLL_MS = 60_000
/** The newest rows read per check: a morning batch stores a handful, and a check that misses some
 *  because a run stored more still announces the newest. */
const IDEA_POLL_LIMIT = 10

function toIdeaEvent(item: StoredSuggestion): WireEvent {
  return {
    v: 1,
    kind: 'idea',
    weight: 'nudge',
    source: APP_SOURCE,
    idea: {
      suggestionId: item.id,
      instrument: { market: item.instrument.market, ticker: item.instrument.ticker },
      action: item.action,
      conviction: item.conviction,
    },
  }
}

/** Announces each buy or reduce stored since the last check as an `idea` event. The trading layer
 *  raises no event when it stores one, so the app hears of it here, within a minute. Holds are
 *  left out: most are the exit plans a recorded buy writes. The first check only sets the
 *  baseline, since a daemon start is not a new idea. Returns the stop. */
export function startIdeaWatch(app: App): () => void {
  const host = app.resolve('tradingHost')
  const logger = app.resolve('logger')
  const controller = new AbortController()
  let baselined = false
  let newestId: string | undefined
  let checking = false

  const check = async (): Promise<void> => {
    if (checking) {
      return
    }

    checking = true

    try {
      // A new suggestion is the newest standing verdict on its name, so it heads the open list.
      const page = await host.listSuggestions({
        status: 'open',
        limit: IDEA_POLL_LIMIT,
        signal: controller.signal,
      })
      const seen = newestId
      const fresh = baselined
        ? page.items.filter(
            (item) => (seen === undefined || item.id > seen) && item.action !== 'hold'
          )
        : []

      baselined = true
      newestId = page.items[0]?.id ?? newestId

      for (const item of [...fresh].reverse()) {
        broadcast(toIdeaEvent(item))
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        logger.warn('api.idea_watch_failed', { err: formatErrForLog(err) })
      }
    } finally {
      checking = false
    }
  }

  // `check` catches its own failures, so nothing is left to handle here.
  const run = (): void => {
    check().catch(() => undefined)
  }
  const timer = setInterval(run, IDEA_POLL_MS)

  timer.unref()
  run()

  return () => {
    clearInterval(timer)
    controller.abort()
  }
}
