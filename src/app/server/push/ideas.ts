import type { WireEvent } from '@/app/server/wire/events'
import type { App } from '@/core/container'
import type { StoredSuggestion } from '@/trading/api'
import { APP_SOURCE } from '@/app/server/channel'
import { toInstrumentWire } from '@/app/server/mappers/trading'
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
      instrument: toInstrumentWire(item.instrument),
      action: item.action,
      conviction: item.conviction,
    },
  }
}

function newIdeas(
  items: readonly StoredSuggestion[],
  seen: string | undefined
): readonly StoredSuggestion[] {
  return items.filter((item) => (seen === undefined || item.id > seen) && item.action !== 'hold')
}

/** Announces each buy or reduce stored since the last check as an `idea` event. The trading layer
 *  raises no event when it stores one, so the app hears of it here, within a minute. Holds are
 *  left out: most are the exit plans a recorded buy writes. The first check only sets the
 *  baseline, since a daemon start is not a new idea. The returned stop waits out a check in
 *  flight. */
export function startIdeaWatch(app: App): () => Promise<void> {
  const host = app.resolve('tradingHost')
  const logger = app.resolve('logger')
  const controller = new AbortController()
  let baselined = false
  let newestId: string | undefined
  let inFlight: Promise<void> | null = null

  const check = async (): Promise<void> => {
    try {
      // A new suggestion is the newest standing verdict on its name, so it heads the open list.
      const page = await host.listSuggestions({
        status: 'open',
        limit: IDEA_POLL_LIMIT,
        signal: controller.signal,
      })
      const fresh = baselined ? newIdeas(page.items, newestId) : []

      baselined = true
      newestId = page.items[0]?.id ?? newestId

      for (const item of [...fresh].reverse()) {
        broadcast(toIdeaEvent(item))
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        logger.warn('api.idea_watch_failed', { err: formatErrForLog(err) })
      }
    }
  }

  // `check` catches its own failures, so the chain only clears the guard.
  const run = (): void => {
    if (inFlight !== null) {
      return
    }

    inFlight = check().finally(() => {
      inFlight = null
    })
  }
  const timer = setInterval(run, IDEA_POLL_MS)

  timer.unref()
  run()

  return async () => {
    clearInterval(timer)
    controller.abort()

    if (inFlight !== null) {
      await inFlight
    }
  }
}
