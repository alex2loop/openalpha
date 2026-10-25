import { computed, type ReadonlySignal } from '@preact/signals'

import type { MarketWire, OverviewResponse } from '@/app/server/wire/market'
import type { StopsResponse } from '@/app/server/wire/money'
import type {
  AbsolutePositionWire,
  InstrumentRefWire,
  SuggestionWire,
  TradingQuoteWire,
} from '@/app/server/wire/trading'
import { ROUTES } from '@/web/api/routes'
import { createRouteBlock } from '@/web/state/block'

const OVERVIEW_POLL_MS = 60_000
// Each poll makes the daemon read live providers, so it stays slow.
const QUOTES_POLL_MS = 60_000

type StopRow = StopsResponse['stops'][number]

const marketsBlock = createRouteBlock(ROUTES.markets)
export const overviewBlock = createRouteBlock(ROUTES.overview)
export const holdingsBlock = createRouteBlock(ROUTES.portfolio)
export const quotesBlock = createRouteBlock(ROUTES.quotes)
export const stopsBlock = createRouteBlock(ROUTES.stops)
export const profileBlock = createRouteBlock(ROUTES.profile)
export const alertsBlock = createRouteBlock(ROUTES.alerts)
const callsBlock = createRouteBlock(ROUTES.suggestions, { status: 'open' })

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
    alertsBlock.start(OVERVIEW_POLL_MS),
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

/** How the market prints a price, off `/v1/markets`; absent for a market with no board scale. */
export function priceDisplayOf(market: string): MarketWire['priceDisplay'] {
  return findMarket(market)?.priceDisplay
}

function homeRegion(): string | undefined {
  return marketsBlock.view.value.data?.homeRegion
}

/** The overview's markets in the home region, or in every other region. */
export function selectOverview(scope: 'home' | 'other'): OverviewResponse['markets'] {
  const home = homeRegion()
  const blocks = overviewBlock.view.value.data?.markets ?? []

  if (home === undefined) {
    return []
  }

  return blocks.filter((block) => {
    const isHome = findMarket(block.market)?.region === home

    return scope === 'home' ? isHome : !isHome
  })
}
