import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { FxQuote } from '@/trading/kernel/market/market-data'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'

const RATE_KEYS = ['from_currency', 'to_currency']
const RATE_COLS = ['rate', 'as_of', 'source_id', 'fetched_at']

interface RateRow {
  readonly rate: number
  readonly as_of: string
  readonly source_id: string
  readonly fetched_at: number
}

interface FxRatePair {
  readonly fromCurrency: CurrencyCode
  readonly toCurrency: CurrencyCode
}

/** The last rate each pair resolved to, one row per pair and overwritten in place. A direction is
 *  its own row: nothing here inverts a rate, because the provider that quotes one side is not
 *  always the one that quotes the other. */
export interface FxRateStore {
  find(pair: FxRatePair, signal: AbortSignal): Promise<FxQuote | null>
  upsert(quote: FxQuote, signal: AbortSignal): Promise<void>
}

export function createFxRateStore(deps: StoreDeps): FxRateStore {
  return {
    async find(pair, signal) {
      assertNotAborted(signal)

      const p = deps.dialect.param
      const rows = await deps.db.query<RateRow>(
        `SELECT * FROM fx_rates WHERE from_currency = ${p(1)} AND to_currency = ${p(2)}`,
        [pair.fromCurrency, pair.toCurrency]
      )
      const [row] = rows

      return row === undefined ? null : toQuote(pair, row)
    },

    async upsert(quote, signal) {
      assertNotAborted(signal)

      const sql = deps.dialect.upsert('fx_rates', {
        keys: RATE_KEYS,
        cols: RATE_COLS,
        rowCount: 1,
      })

      await deps.db.execute(sql, [
        quote.fromCurrency,
        quote.toCurrency,
        quote.rate,
        quote.asOf,
        quote.sourceId,
        quote.fetchedAt,
      ])
    },
  }
}

/** The pair comes from the request, not the row: both key columns were bound to it, so reading
 *  them back would only restate what was asked. */
function toQuote(pair: FxRatePair, row: RateRow): FxQuote {
  return {
    fromCurrency: pair.fromCurrency,
    toCurrency: pair.toCurrency,
    rate: row.rate,
    asOf: tradingDay(row.as_of),
    sourceId: sourceId(row.source_id),
    fetchedAt: row.fetched_at,
  }
}
