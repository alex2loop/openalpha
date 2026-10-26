import { computed, type ReadonlySignal } from '@preact/signals'

import type { MarketWire } from '@/app/server/wire/market'
import type { TradingQuoteWire } from '@/app/server/wire/trading'
import {
  keyOf,
  knownMarkets,
  overviewBlock,
  priceDisplayOf,
  profileBlock,
  quotesBlock,
} from '@/web/state/market'
import { isSegmentOn } from '@/web/state/profile'

/** One name on the price tape. */
export interface TapeRow {
  readonly key: string
  readonly market: string
  readonly ticker: string
  readonly price?: number
  readonly changePct?: number
  /** Absent for an index level, which prints bare. */
  readonly display?: MarketWire['priceDisplay']
  /** The row is its market's benchmark, not a watched name. */
  readonly isBenchmark?: true
}

/** The benchmark (VN-Index, BTC) of each market whose segment is on, off the overview, then the
 *  watchlist names it does not already carry. No benchmark shows before the profile is read. */
export const tapeRows: ReadonlySignal<readonly TapeRow[]> = computed(() => {
  const profile = profileBlock.view.value.data
  const traded = knownMarkets.value.filter(
    (market) => profile !== undefined && isSegmentOn(profile, market.segment)
  )
  const benchmarks = traded.flatMap(toBenchmarkRows)
  const known = new Set(benchmarks.map((row) => row.key))
  const watched = (quotesBlock.view.value.data?.quotes ?? [])
    .map(toQuoteRow)
    .filter((row) => !known.has(row.key))

  return [...benchmarks, ...watched]
})

function toBenchmarkRows(market: MarketWire): readonly TapeRow[] {
  const { benchmark } = market
  const block = overviewBlock.view.value.data?.markets.find((held) => held.market === market.market)
  const row = block?.rows.find(
    (overview) => benchmark !== undefined && keyOf(overview.instrument) === keyOf(benchmark)
  )

  if (benchmark === undefined || block === undefined || row === undefined) {
    return []
  }

  // A block with no price currency quotes index levels.
  const display = block.priceCurrency === undefined ? undefined : market.priceDisplay

  return [
    {
      key: keyOf(benchmark),
      market: benchmark.market,
      ticker: benchmark.ticker,
      ...(row.price === undefined ? {} : { price: row.price }),
      ...(row.changePct === undefined ? {} : { changePct: row.changePct }),
      ...(display === undefined ? {} : { display }),
      isBenchmark: true,
    },
  ]
}

function toQuoteRow(quote: TradingQuoteWire): TapeRow {
  const display = quote.kind === 'index' ? undefined : priceDisplayOf(quote.market)

  return {
    key: keyOf(quote),
    market: quote.market,
    ticker: quote.ticker,
    price: quote.last,
    ...(quote.changePct === undefined ? {} : { changePct: quote.changePct }),
    ...(display === undefined ? {} : { display }),
  }
}
