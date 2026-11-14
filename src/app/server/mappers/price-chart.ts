import type { TradingPriceChartResponse } from '@/app/server/wire/price-chart'
import type { Locale } from '@/core/types/locale'
import type { Caveat, MarketRef, PriceChart, SourceProvenance, Ticker } from '@/trading/api'
import { toCandleWire, toCaveatWires, toProvenanceWires } from '@/app/server/mappers/trading'

interface PriceChartInput {
  readonly market: MarketRef
  readonly ticker: Ticker
  readonly sector?: string
  readonly chart: PriceChart
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

export function toPriceChartWire(
  input: PriceChartInput,
  locale: Locale
): TradingPriceChartResponse {
  const { chart } = input

  return {
    market: input.market,
    ticker: input.ticker,
    ...(input.sector === undefined ? {} : { sector: input.sector }),
    window: chart.window,
    bars: chart.candles.map(toCandleWire),
    averages: chart.averages.map((average) => ({
      sessions: average.sessions,
      values: average.values.map((value) => value ?? null),
    })),
    ...(chart.relativeVolume === undefined ? {} : { relativeVolume: chart.relativeVolume }),
    provenance: toProvenanceWires(input.provenance),
    caveats: toCaveatWires(input.caveats, locale),
  }
}
