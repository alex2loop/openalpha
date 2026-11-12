import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { MarketWire } from '@/app/server/wire/market'
import type { StopsResponse } from '@/app/server/wire/money'
import type { OverviewResponse } from '@/app/server/wire/overview'
import type {
  AbsolutePositionWire,
  InstrumentRefWire,
  SuggestionWire,
  TradingProfileResponse,
  TradingQuoteWire,
} from '@/app/server/wire/trading'
import type { SessionPhase } from '@/app/server/wire/vocab'
import type { PriceFormat } from '@/web/text/figures'
import { ROUTES } from '@/web/api/routes'
import { createRouteBlock } from '@/web/state/block'
import { setCapped } from '@/web/state/capped-map'

const OVERVIEW_POLL_MS = 60_000
// Each poll makes the daemon read live providers, so it stays slow.
const QUOTES_POLL_MS = 60_000
// The names a live read has told the page publish a level or not, past the board's own.
const MAX_READ_LEVELS = 200

type StopRow = StopsResponse['stops'][number]
type LevelRead = Pick<TradingQuoteWire, 'market' | 'ticker' | 'isLevel'>

const TRADING_PHASES: ReadonlySet<SessionPhase> = new Set(['open', 'break'])

const readLevels = signal<ReadonlyMap<string, LevelRead>>(new Map())

export const marketsBlock = createRouteBlock(ROUTES.markets)
export const overviewBlock = createRouteBlock(ROUTES.overview)
export const holdingsBlock = createRouteBlock(ROUTES.portfolio)
export const quotesBlock = createRouteBlock(ROUTES.quotes)
export const stopsBlock = createRouteBlock(ROUTES.stops)
export const profileBlock = createRouteBlock(ROUTES.profile)
export const alertsBlock = createRouteBlock(ROUTES.alerts)
/** Every name's standing verdict, buys, reductions and holds. */
export const callsBlock = createRouteBlock(ROUTES.suggestions, { status: 'open' })

/** What the operator holds: a residue below the venue's smallest order is not a position. */
export const heldPositions: ReadonlySignal<readonly AbsolutePositionWire[]> = computed(() =>
  (holdingsBlock.view.value.data?.positions ?? []).filter(
    (position) => position.quantity > 0 && !position.belowMinimumSize
  )
)

/** The names the operator watches. */
export const watchedNames: ReadonlySignal<readonly InstrumentRefWire[]> = computed(
  () => profileBlock.view.value.data?.watchlist ?? []
)

/** Held names whose mark is through their plan's stop. */
export const stopBreaches: ReadonlySignal<readonly StopRow[]> = computed(() => {
  const held = new Set(heldPositions.value.map((position) => keyOf(position.instrument)))

  return (stopsBlock.view.value.data?.stops ?? []).filter(
    (stop) =>
      held.has(keyOf(stop.instrument)) &&
      stop.plan === 'distance' &&
      !stop.review &&
      stop.distanceToStopPct !== undefined &&
      stop.distanceToStopPct <= 0
  )
})

/** Every market the daemon trades, in its order; empty until read. */
export const knownMarkets: ReadonlySignal<readonly MarketWire[]> = computed(
  () => marketsBlock.view.value.data?.markets ?? []
)

/** The markets that answer `/v1/screen` and a page lists, in the daemon's order. */
export const boardMarkets: ReadonlySignal<readonly MarketWire[]> = computed(() =>
  knownMarkets.value.filter((market) => market.hasBoard && isMarketShown(market))
)

/** Every standing buy call: a name's open verdict is replaced when the daemon calls it again. */
export const freshCalls: ReadonlySignal<readonly SuggestionWire[]> = computed(() =>
  (callsBlock.view.value.data?.suggestions ?? []).filter((call) => call.action === 'buy')
)

/** Reads the market data now and keeps it fresh until the returned stop. */
export function startMarket(): () => void {
  const stops = [
    marketsBlock.start(OVERVIEW_POLL_MS),
    overviewBlock.start(OVERVIEW_POLL_MS),
    holdingsBlock.start(OVERVIEW_POLL_MS),
    stopsBlock.start(OVERVIEW_POLL_MS),
    profileBlock.start(OVERVIEW_POLL_MS),
    callsBlock.start(OVERVIEW_POLL_MS),
    quotesBlock.start(QUOTES_POLL_MS),
  ]

  return () => {
    for (const stop of stops) {
      stop()
    }
  }
}

/** `market:ticker`: one instrument's identity across the page's lists. */
export function keyOf(instrument: { readonly market: string; readonly ticker: string }): string {
  return `${instrument.market}:${instrument.ticker}`
}

export function findMarket(market: string): MarketWire | undefined {
  return marketsBlock.view.value.data?.markets.find((held) => held.market === market)
}

/** The board's quote for a name; `market` left off finds the first board name with that ticker. */
export function findQuote(ticker: string, market?: string): TradingQuoteWire | undefined {
  return (quotesBlock.view.value.data?.quotes ?? []).find(
    (quote) => quote.ticker === ticker && (market === undefined || quote.market === market)
  )
}

/** Keeps whether a live read of `quote` found its name a level, for a name the board does not
 *  carry. A poll that finds the same answer leaves the store alone. */
export function noteQuoteLevel(quote: TradingQuoteWire): void {
  const key = keyOf(quote)

  if (readLevels.value.get(key)?.isLevel === quote.isLevel) {
    return
  }

  const next = new Map(readLevels.value)

  setCapped(
    next,
    [key, { market: quote.market, ticker: quote.ticker, isLevel: quote.isLevel }],
    MAX_READ_LEVELS
  )
  readLevels.value = next
}

/** Whether the name's quote says it publishes a level: an index or a futures contract is read,
 *  never bought or analysed. A name no quote has described is not: a slow quote never hides from a
 *  real stock what it can do. Without a market, the board's first quote of the ticker answers; a
 *  name the board lacks is a level when any market's read of it said so. */
export function isLevelInstrument(instrument: {
  readonly market?: string
  readonly ticker: string
}): boolean {
  const { market, ticker } = instrument
  const found = findQuote(ticker, market)

  if (found !== undefined) {
    return found.isLevel
  }

  return market === undefined
    ? [...readLevels.value.values()].some((read) => read.isLevel && read.ticker === ticker)
    : (readLevels.value.get(keyOf({ market, ticker }))?.isLevel ?? false)
}

/** How the market prints a price, off `/v1/markets`; absent for a market with no board scale. */
export function priceDisplayOf(market: string): MarketWire['priceDisplay'] {
  return findMarket(market)?.priceDisplay
}

/** How the page prints a market's price: its board scale, else its currency's own precision; absent
 *  until the markets are read. */
export function printDisplayOf(market: string): PriceFormat | undefined {
  const found = findMarket(market)

  return found === undefined ? undefined : (found.priceDisplay ?? { currency: found.currency })
}

/** The operator's region (`[locale] region`); absent until the markets are read. */
export function homeRegion(): string | undefined {
  return marketsBlock.view.value.data?.homeRegion
}

/** The market that owns the operator's region: its calendar dates the ledger's day. Absent until the
 *  markets are read. */
export function homeMarket(): MarketWire | undefined {
  const region = homeRegion()

  return knownMarkets.value.find((market) => market.region === region && market.ownsRegion)
}

/** A market in this phase still trades today: open, or in its lunch break. */
export function isTradingPhase(phase: SessionPhase): boolean {
  return TRADING_PHASES.has(phase)
}

/** A segment the operator has not switched off: some cap leaves it room. */
export function isSegmentOn(profile: TradingProfileResponse, segment: string): boolean {
  const cap = profile.caps[segment]

  return cap === undefined || cap.maximumPositionPctNav > 0 || cap.maximumSegmentPctNav > 0
}

/** A market a page lists: its segment is on, or no venue can hold it (world gold, read for
 *  reference). Every market counts before the profile is read. */
export function isMarketShown(market: MarketWire): boolean {
  const profile = profileBlock.view.value.data

  return profile === undefined || !market.holdable || isSegmentOn(profile, market.segment)
}

/** The overview's markets in `region` that a page lists, in the daemon's order. */
export function selectRegionOverview(region: string): OverviewResponse['markets'] {
  return (overviewBlock.view.value.data?.markets ?? []).filter((block) => {
    const market = findMarket(block.market)

    return market?.region === region && isMarketShown(market)
  })
}

/** The overview's markets a page lists in the home region, or in every other region. */
export function selectOverview(scope: 'home' | 'other'): OverviewResponse['markets'] {
  const home = homeRegion()
  const blocks = overviewBlock.view.value.data?.markets ?? []

  if (home === undefined) {
    return []
  }

  return blocks.filter((block) => {
    const market = findMarket(block.market)

    if (market === undefined || !isMarketShown(market)) {
      return false
    }

    return scope === 'home' ? market.region === home : market.region !== home
  })
}
