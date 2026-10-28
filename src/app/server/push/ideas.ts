import type { WireEvent } from '@/app/server/wire/events'
import type { App } from '@/core/container'
import type { StoredSuggestion, TradingHost } from '@/trading/api'
import { APP_SOURCE } from '@/app/server/channel'
import { toInstrumentWire } from '@/app/server/mappers/trading'
import { broadcast } from '@/app/server/ws/socket'
import { ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { isBookFocus, resolveRunFocus } from '@/trading/api'

const IDEA_POLL_MS = 60_000
/** The newest rows read per focus and check: a morning batch stores a handful, and a check that
 *  misses some because a run stored more still announces the newest. */
const IDEA_POLL_LIMIT = 10

/** One focus the watch reads: the operator's own (no key, told by the app), or one or more own
 *  agents' shared `[focus]`, each told under the agent's id. */
interface IdeaFeed {
  readonly focusKey?: string
  readonly agentIds: readonly string[]
}

const BOOK_FEED: IdeaFeed = Object.freeze({ agentIds: Object.freeze([]) })

function toIdeaEvent(item: StoredSuggestion, agentId?: string): WireEvent {
  return {
    v: 1,
    kind: 'idea',
    weight: agentId === undefined ? 'nudge' : 'quiet',
    source: agentId === undefined ? APP_SOURCE : { ...APP_SOURCE, agentId },
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

/** Announces each buy or reduce stored since the last check as an `idea` event: the operator's own
 *  calls from the app, and each own agent's focus calls under that agent's id. The trading layer
 *  raises no event when it stores one, so the app hears of it here, within a minute. Holds are
 *  left out: most are the exit plans a recorded buy writes. A focus's first check only sets its
 *  baseline, since a daemon start or a new agent is not a new idea. The returned stop waits out a
 *  check in flight. */
export function startIdeaWatch(app: App): () => Promise<void> {
  const host = app.resolve('tradingHost')
  const logger = app.resolve('logger')
  const controller = new AbortController()
  // The newest id seen per focus; a focus with no entry has not been baselined.
  const newest = new Map<string, string | undefined>()
  let inFlight: Promise<void> | null = null

  const check = async (): Promise<void> => {
    try {
      const feeds = ideaFeedsOf(app)

      for (const feed of feeds) {
        await checkFeed({ host, newest, signal: controller.signal }, feed)
      }

      forgetGone(newest, feeds)
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

interface FeedCheck {
  readonly host: TradingHost
  readonly newest: Map<string, string | undefined>
  readonly signal: AbortSignal
}

async function checkFeed(watch: FeedCheck, feed: IdeaFeed): Promise<void> {
  const key = feed.focusKey ?? ''
  const items = await readOpenCalls(watch.host, feed.focusKey, watch.signal)
  const seen = watch.newest.get(key)
  const fresh = watch.newest.has(key) ? newIdeas(items, seen) : []

  watch.newest.set(key, items[0]?.id ?? seen)

  for (const item of [...fresh].reverse()) {
    announce(item, feed)
  }
}

function announce(item: StoredSuggestion, feed: IdeaFeed): void {
  if (feed.focusKey === undefined) {
    broadcast(toIdeaEvent(item))

    return
  }

  for (const agentId of feed.agentIds) {
    broadcast(toIdeaEvent(item, agentId))
  }
}

/** The operator's own focus, then each `[focus]` the own agents use now, with the agents sharing
 *  it. An agent with no `[focus]` calls for the operator's own record, so its ideas are the app's. */
function ideaFeedsOf(app: App): readonly IdeaFeed[] {
  const registry = app.resolve('agents')
  const byFocus = new Map<string, string[]>()

  for (const id of [...app.resolve('userAgentIds')()].sort()) {
    const agent = registry.get(id)
    const focus = agent === undefined ? undefined : resolveRunFocus(agent.focus)

    if (focus !== undefined && !isBookFocus(focus)) {
      byFocus.set(focus.key, [...(byFocus.get(focus.key) ?? []), id])
    }
  }

  return [BOOK_FEED, ...[...byFocus].map(([focusKey, agentIds]) => ({ focusKey, agentIds }))]
}

/** A new suggestion is the newest standing verdict on its name, so it heads the open list. A focus
 *  no agent has called under yet is refused by the list, and has nothing to announce. */
async function readOpenCalls(
  host: TradingHost,
  focusKey: string | undefined,
  signal: AbortSignal
): Promise<readonly StoredSuggestion[]> {
  try {
    const page = await host.listSuggestions({
      status: 'open',
      ...(focusKey === undefined ? {} : { focusKey }),
      limit: IDEA_POLL_LIMIT,
      signal,
    })

    return page.items
  } catch (err: unknown) {
    if (focusKey !== undefined && err instanceof ValidationError) {
      return []
    }

    throw err
  }
}

/** Keeps the map to the focuses still watched, so a removed agent or an edited `[focus]` leaves no
 *  entry behind. */
function forgetGone(newest: Map<string, string | undefined>, feeds: readonly IdeaFeed[]): void {
  const watched = new Set(feeds.map((feed) => feed.focusKey ?? ''))

  for (const key of [...newest.keys()]) {
    if (!watched.has(key)) {
      newest.delete(key)
    }
  }
}
