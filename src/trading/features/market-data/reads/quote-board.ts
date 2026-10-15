import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type {
  QuoteBoard,
  QuoteBoardItem,
  QuoteBoardRequest,
} from '@/trading/kernel/market/market-capability'
import type { MarketRegistry } from '@/trading/markets/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { freshnessOf } from '@/trading/features/market-data/reads/freshness'
import { settledCloseBefore } from '@/trading/features/market-data/reads/previous-close'
import { dedupeInstruments } from '@/trading/kernel/instrument'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const QUOTE_BOARD_CONCURRENCY = 4

interface QuoteBoardDeps {
  readonly markets: MarketRegistry
  /** `[locale] timezone`: one clock for every row, so a 24/7 market and a session market do not
   *  report the same instant under two different times. */
  readonly timezone: string
}

export async function buildQuoteBoard(
  deps: QuoteBoardDeps,
  options: QuoteBoardRequest
): Promise<QuoteBoard> {
  // One clock read for the whole quoteBoard: rows stamped from separate reads can disagree about the
  // trading day at a session boundary.
  const now = Date.now()
  const identities = dedupeInstruments(options.instruments)
  const scoped = identities.slice(0, SURFACE_LIMITS.maximumQuoteBoardItems)
  const caveats: Caveat[] =
    identities.length > scoped.length
      ? [
          {
            code: 'market-data.universe-truncated',
            detail: { examined: scoped.length, eligible: identities.length },
          },
        ]
      : []

  const resolved = await mapWithConcurrency(scoped, QUOTE_BOARD_CONCURRENCY, (instrument) =>
    quoteBoardItemFor(deps, instrument, { signal: options.signal, now })
  )
  const items: QuoteBoardItem[] = []

  for (const [index, item] of resolved.entries()) {
    if (item === null) {
      const instrument = scoped[index]

      if (instrument !== undefined) {
        caveats.push({
          code: 'source.no-available-provider',
          detail: { sourceKind: 'quote', market: instrument.market, ticker: instrument.ticker },
        })
      }
      continue
    }

    items.push(item)
  }

  return { items, caveats }
}

/** An unsupported, unavailable, or non-finite observation becomes a caveat, never a zero item: a
 *  fake price on a quoteBoard row is indistinguishable from a real one. */
async function quoteBoardItemFor(
  deps: QuoteBoardDeps,
  instrument: InstrumentRef,
  clock: { readonly now: number; readonly signal: AbortSignal }
): Promise<QuoteBoardItem | null> {
  const market = deps.markets.find(instrument.market)

  if (market === null) {
    return null
  }

  const result = await market.capabilities.quote?.run({
    instrument,
    asOf: market.manifest.calendar.dayAt(clock.now),
    now: clock.now,
    signal: clock.signal,
  })

  if (result === undefined || result.kind === 'unavailable') {
    return null
  }

  const { price, changePct, observedAt, session } = result.value

  if (!Number.isFinite(price)) {
    return null
  }

  const observed = freshnessOf(
    { calendar: market.manifest.calendar, timezone: deps.timezone },
    observedAt,
    clock.now
  )
  const previousClose = await settledCloseBefore(market, instrument, {
    observed,
    now: clock.now,
    signal: clock.signal,
  })

  const settled =
    observed.kind === 'close' &&
    observed.day <= resolveSettledDay(market.manifest.calendar, clock.now)

  return {
    observed,
    ...(settled ? { closedOn: observed.day } : {}),
    ...(previousClose === undefined ? {} : { previousClose }),
    // The manifest's own asset class names the item; `fx` is excluded by construction because an
    // FX pair has no owning market.
    kind: market.manifest.assetClass,
    ticker: instrument.ticker,
    region: market.manifest.region,
    currency: market.manifest.currency,
    market: market.manifest.id,
    assetClass: market.manifest.assetClass,
    ...(session === undefined ? {} : { session }),
    ...(session?.volume === undefined ? {} : { sessionVolume: session.volume }),
    last: price,
    ...(changePct === undefined || !Number.isFinite(changePct) ? {} : { changePct }),
    provenance: result.provenance,
    caveats: result.caveats,
  }
}
