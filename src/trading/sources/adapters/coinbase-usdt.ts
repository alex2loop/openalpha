import type { Candle } from '@/trading/kernel/market/market-data'
import { tradingDay } from '@/trading/kernel/instrument'
import {
  dayFromEpochSeconds,
  dropInvalid,
  positive,
  toCandle,
} from '@/trading/sources/rows/normalization'

/** One last trade: its price against the dollar and when it printed. */
interface TickerReading {
  readonly price: number
  readonly observedAt: number
}

/** Coinbase's candle rows: time in epoch seconds, then low, high, open, close, volume. */
export type CandleRow = readonly [number, number, number, number, number, number]

/** The crypto book prices in USDT and Coinbase quotes in dollars, so a coin's dollar price is
 *  divided by the dollar price of one USDT. The older of the two stamps dates it, because the quote
 *  is only as fresh as its stalest leg. */
export function toUsdtQuote(coin: TickerReading, peg: TickerReading): TickerReading {
  return {
    price: positive(coin.price, 'price') / positive(peg.price, 'peg'),
    observedAt: Math.min(coin.observedAt, peg.observedAt),
  }
}

/** Each bar's four prices are divided by the peg's close on the same UTC day; a day with no peg
 *  close is dropped, never converted at a neighbouring day's rate. Oldest first. */
export function toUsdtCandles(
  coinRows: readonly CandleRow[],
  pegRows: readonly CandleRow[]
): readonly Candle[] {
  const peg = new Map<string, number>(
    pegRows.map(([time, , , , close]) => [dayFromEpochSeconds(time, 'UTC'), close])
  )
  const candles = dropInvalid(coinRows, ([time, low, high, open, close, volume]) => {
    const at = tradingDay(dayFromEpochSeconds(time, 'UTC'))
    const rate = positive(peg.get(at), 'peg close')

    return toCandle({
      at,
      open: open / rate,
      high: high / rate,
      low: low / rate,
      close: close / rate,
      volume,
      adjustment: 'raw',
    })
  })

  return candles.toSorted((left, right) => left.at.localeCompare(right.at))
}
