import type {
  IndexContributorsResponse,
  IndexValuationResponse,
} from '@/app/server/wire/index-reading'
import type { Locale } from '@/core/types/locale'
import type {
  IndexCode,
  IndexContribution,
  IndexContributorsReading,
  IndexValuationReading,
  MarketRef,
  SourceResult,
} from '@/trading/api'
import { percent, toCaveatWires, toInstrumentWire } from '@/app/server/mappers/trading'

export function toIndexContributorsWire(
  scope: { readonly market: MarketRef; readonly index: IndexCode },
  result: SourceResult<IndexContributorsReading>,
  locale: Locale
): IndexContributorsResponse {
  const { market, index } = scope
  const caveats = toCaveatWires(result.caveats, locale)

  if (result.kind === 'unavailable') {
    return { market, index, caveats }
  }

  const { asOf, up, down, upSum, downSum } = result.value
  const toWire = (row: IndexContribution) => ({
    instrument: toInstrumentWire({ market, ticker: row.ticker }),
    point: row.point,
    price: row.price,
  })

  return {
    market,
    index,
    contributors: { asOf, up: up.map(toWire), down: down.map(toWire), upSum, downSum },
    caveats,
  }
}

export function toIndexValuationWire(
  scope: { readonly market: MarketRef; readonly index: IndexCode },
  result: SourceResult<IndexValuationReading>,
  locale: Locale
): IndexValuationResponse {
  const { market, index } = scope
  const caveats = toCaveatWires(result.caveats, locale)

  if (result.kind === 'unavailable') {
    return { market, index, caveats }
  }

  const reading = result.value
  const {
    dividendYield,
    averagePriceToEarnings5y: peAvg5y,
    averagePriceToBook5y: pbAvg5y,
    aboveMa50Ratio,
    aboveMa200Ratio,
  } = reading

  return {
    market,
    index,
    valuation: {
      asOf: reading.asOf,
      pe: reading.priceToEarnings,
      pb: reading.priceToBook,
      roePct: percent(reading.returnOnEquity),
      ...(dividendYield === undefined ? {} : { dividendYieldPct: percent(dividendYield) }),
      ...(peAvg5y === undefined ? {} : { peAvg5y }),
      ...(pbAvg5y === undefined ? {} : { pbAvg5y }),
      ...(aboveMa50Ratio === undefined ? {} : { aboveMa50Pct: percent(aboveMa50Ratio) }),
      ...(aboveMa200Ratio === undefined ? {} : { aboveMa200Pct: percent(aboveMa200Ratio) }),
    },
    caveats,
  }
}
