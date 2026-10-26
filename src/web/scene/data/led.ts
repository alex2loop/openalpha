import { computed, effect, type ReadonlySignal, signal } from '@preact/signals'

import type { MarketWire, OverviewResponse } from '@/app/server/wire/market'
import { homeMarket } from '@/web/scene/data/home'
import { knownMarkets, overviewBlock } from '@/web/state/market'

/** The most levels one board item keeps: the polls since the page opened. */
const MAX_LED_POINTS = 600

type OverviewBlock = OverviewResponse['markets'][number]

/** What the market is doing now, as its own wire phase says: never the preview clock. */
type LedState = 'open' | 'break' | 'closed'

/** One market's benchmark on the LED board and the desk screens. `changePct` and `level` stay
 *  absent when the wire sent none; `isPrice` marks a benchmark priced in a currency (an index
 *  publishes a level), printed by `display` where the market scales its board; `line` is the levels polled since the page opened; `at` is the last good read (epoch
 *  ms) and `stale` is true while the newest poll failed. */
export interface LedItem {
  readonly label: string
  readonly level?: number
  readonly isPrice: boolean
  readonly display?: MarketWire['priceDisplay']
  readonly changePct?: number
  readonly state: LedState
  readonly line: readonly number[]
  readonly at?: number
  readonly stale: boolean
}

interface LedEntry {
  readonly market: string
  readonly item: LedItem
}

/** The levels one index has gathered in one trading day. */
interface Track {
  readonly day: string | undefined
  readonly line: readonly number[]
}

const entries = signal<readonly LedEntry[]>([])

/** One item per overview block with a benchmark to show, in the overview's order. */
export const ledItems: ReadonlySignal<readonly LedItem[]> = computed(() =>
  entries.value.map((entry) => entry.item)
)

/** The home market's benchmark index among the items; absent until the overview carries it, and
 *  for a home market priced in a currency. */
export const homeIndex: ReadonlySignal<LedItem | undefined> = computed(() => {
  const market = homeMarket.value
  const ticker = market?.benchmark?.ticker

  return entries.value.find(
    (entry) => entry.market === market?.market && entry.item.label === ticker && !entry.item.isPrice
  )?.item
})

/** Folds each overview read into the items for as long as the scene is up; the returned stop
 *  releases the watch and empties them. */
export function startLed(): () => void {
  const tracks = new Map<string, Track>()
  let readAt: number | undefined

  const stop = effect(() => {
    const view = overviewBlock.view.value
    const markets = knownMarkets.value
    const isNewRead = view.readAt !== readAt

    readAt = view.readAt
    entries.value = (view.data?.markets ?? []).flatMap((block) => {
      const entry = readEntry(block, {
        market: markets.find((held) => held.market === block.market),
        tracks,
        isNewRead,
        at: view.readAt,
        isStale: view.state === 'failed',
      })

      return entry === undefined ? [] : [entry]
    })
  })

  return () => {
    stop()
    tracks.clear()
    entries.value = []
  }
}

interface ReadJob {
  readonly market: MarketWire | undefined
  readonly tracks: Map<string, Track>
  readonly isNewRead: boolean
  readonly at: number | undefined
  readonly isStale: boolean
}

// An index block shows its benchmark, else its first level; a block priced in a currency shows
// only its benchmark, printed as the tape prints it, never some other name's price.
function readEntry(block: OverviewBlock, job: ReadJob): LedEntry | undefined {
  const benchmark = job.market?.benchmark?.ticker
  const isPriced = block.priceCurrency !== undefined
  const held = block.rows.find((one) => one.instrument.ticker === benchmark)
  const row = isPriced ? held : (held ?? block.rows[0])
  const display = isPriced ? job.market?.priceDisplay : undefined

  if (row === undefined) {
    return undefined
  }

  const key = `${block.market}:${row.instrument.ticker}`
  const track = trackOf(job, key, row.price)

  job.tracks.set(key, track)

  return {
    market: block.market,
    item: {
      label: row.instrument.ticker,
      ...(row.price === undefined ? {} : { level: row.price }),
      isPrice: isPriced,
      ...(display === undefined ? {} : { display }),
      ...(row.changePct === undefined ? {} : { changePct: row.changePct }),
      state: stateOf(job.market),
      line: track.line,
      ...(job.at === undefined ? {} : { at: job.at }),
      stale: job.isStale,
    },
  }
}

// A good read adds its level; a new trading day starts the line again.
function trackOf(job: ReadJob, key: string, level: number | undefined): Track {
  const day = job.market?.session?.today
  const held = job.tracks.get(key)
  const line = held?.day === day ? (held?.line ?? []) : []

  if (!job.isNewRead || level === undefined) {
    return { day, line }
  }

  return { day, line: [...line.slice(1 - MAX_LED_POINTS), level] }
}

// A market with no session hours never closes.
function stateOf(market: MarketWire | undefined): LedState {
  if (market === undefined) {
    return 'closed'
  }

  const phase = market.session?.phase

  if (phase === undefined || phase === 'open') {
    return 'open'
  }

  return phase === 'break' ? 'break' : 'closed'
}
