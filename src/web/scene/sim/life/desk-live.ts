import type { ActorId, DeskQuote, MonitorState } from '@/web/scene/types'
import { liveQuotes } from '@/web/scene/data/quote-trail'
import { alertCounts } from '@/web/scene/data/room-status'

/** An idle desk screen turns to its next name this often. */
const QUOTE_TURN_MS = 20_000
// The desks whose idle screen shows a watched or held name, each starting at its own place in the
// list so two desks side by side show different names.
const QUOTE_OWNERS: ReadonlyMap<ActorId, number> = new Map([
  ['trader', 0],
  ['analyst', 1],
])
/** The people whose idle screen shows a real reading rather than the home index or nothing. */
export const LIVE_OWNERS: readonly ActorId[] = [...QUOTE_OWNERS.keys(), 'risk', 'clerk']
const RISK: ActorId = 'risk'

/** What the idle desk screens show, kept in place by the desks. */
interface LiveShown {
  readonly quotes: Map<ActorId, DeskQuote>
  nearStops: number | undefined
}

/** A screen at a seat with its owner sitting idle in front of it. */
export function isSeatedIdle(state: MonitorState | undefined): boolean {
  return state === 'live' || state === 'rest'
}

/** Brings the idle screens' names and the risk desk's count up to date; true when one changed.
 *  Under reduced motion the names hold still. */
export function syncLive(
  shown: LiveShown,
  at: {
    readonly monitors: ReadonlyMap<ActorId, MonitorState>
    readonly nowMs: number
    readonly isReduced: boolean
  }
): boolean {
  const quotes = liveQuotes.value
  const turn = at.isReduced ? 0 : Math.floor(at.nowMs / QUOTE_TURN_MS)
  let isChanged = false

  for (const [owner, offset] of QUOTE_OWNERS) {
    const quote = isSeatedIdle(at.monitors.get(owner))
      ? quotes[(turn + offset) % Math.max(1, quotes.length)]
      : undefined

    if (shown.quotes.get(owner) !== quote) {
      isChanged = true

      if (quote === undefined) {
        shown.quotes.delete(owner)
      } else {
        shown.quotes.set(owner, quote)
      }
    }
  }

  const nearStops = isSeatedIdle(at.monitors.get(RISK)) ? alertCounts.value.nearStops : undefined

  if (shown.nearStops !== nearStops) {
    shown.nearStops = nearStops
    isChanged = true
  }

  return isChanged
}

/** When the idle screens turn to their next names: only while one shows a name and more than one
 *  is there to turn to. */
export function liveDueOf(shown: LiveShown, nowMs: number): number {
  if (shown.quotes.size === 0 || liveQuotes.value.length < 2) {
    return Number.POSITIVE_INFINITY
  }

  return (Math.floor(nowMs / QUOTE_TURN_MS) + 1) * QUOTE_TURN_MS
}
