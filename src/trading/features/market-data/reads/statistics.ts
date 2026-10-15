import type { TradingConfig } from '@/trading/kernel/config'
import type { CurrencyCode, InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { FxRates } from '@/trading/kernel/market/fx-rates'
import type { InstrumentRequest } from '@/trading/kernel/market/market-capability'
import type { FxQuote } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

const STATISTICS_CONCURRENCY = 5

/** What a sizing consumer needs, already converted to the book's base currency. */
export interface BaseStatistics {
  /** Absent wherever the market's own reading is: a zero forbids holding the name at all. */
  readonly averageDailyTurnoverBase?: number
  readonly volatilityDaily?: number
}

interface StatisticsDeps {
  readonly markets: MarketRegistry
  readonly fx: FxRates
  readonly config: TradingConfig
}

interface StatisticsOptions {
  readonly instruments: readonly InstrumentRef[]
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

/** One read per instrument, shared by candidate assembly and the liquidity assessment so the two
 *  cannot disagree about how liquid a holding is. A market that publishes no `statistics`
 *  capability, or one that cannot answer, is simply absent from the map. */
export async function loadInstrumentStatistics(
  deps: StatisticsDeps,
  options: StatisticsOptions
): Promise<ReadonlyMap<string, BaseStatistics>> {
  const rates = await loadRates(deps, options)
  const rows = await mapWithConcurrency(
    options.instruments,
    STATISTICS_CONCURRENCY,
    async (instrument) => {
      const market = deps.markets.find(instrument.market)

      if (market === null) {
        return null
      }

      const statistics = await statisticsFor(market, rates.get(market.manifest.currency), {
        instrument,
        asOf: options.asOf,
        now: options.now,
        signal: options.signal,
      })

      return statistics === null ? null : ([buildInstrumentKey(instrument), statistics] as const)
    }
  )

  return new Map(rows.filter((row): row is readonly [string, BaseStatistics] => row !== null))
}

/** The pair depends only on the market's currency, so each is read once rather than once per
 *  instrument. Only currencies of markets that can answer are read: the rest never convert. */
async function loadRates(
  deps: StatisticsDeps,
  options: StatisticsOptions
): Promise<ReadonlyMap<CurrencyCode, SourceResult<FxQuote>>> {
  const currencies = new Set<CurrencyCode>()

  for (const instrument of options.instruments) {
    const market = deps.markets.find(instrument.market)

    if (market?.capabilities.statistics !== undefined) {
      currencies.add(market.manifest.currency)
    }
  }

  const rates = await Promise.all(
    [...currencies].map(async (currency) => {
      const rate = await deps.fx.convert({
        fromCurrency: currency,
        toCurrency: deps.config.baseCurrency,
        asOf: options.asOf,
        signal: options.signal,
      })

      return [currency, rate] as const
    })
  )

  return new Map(rates)
}

async function statisticsFor(
  market: Market,
  rate: SourceResult<FxQuote> | undefined,
  request: InstrumentRequest
): Promise<BaseStatistics | null> {
  const result = await market.capabilities.statistics?.run(request)

  if (result === undefined || result.kind === 'unavailable') {
    return null
  }

  if (rate === undefined || rate.kind === 'unavailable') {
    return null
  }

  const { averageDailyTurnover, volatilityDaily } = result.value

  return {
    ...(averageDailyTurnover === undefined
      ? {}
      : { averageDailyTurnoverBase: averageDailyTurnover * rate.value.rate }),
    ...(volatilityDaily === undefined ? {} : { volatilityDaily }),
  }
}
