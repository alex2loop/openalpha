import type { Ticker } from '@/trading/kernel/instrument'
import type { VenueCatalog, VenueInstrument } from '@/trading/kernel/venue/catalog'
import type { OkxRow } from '@/trading/venues/okx/transport'
import { isTickerShape, marketRef, ticker } from '@/trading/kernel/instrument'
import { toTicker } from '@/trading/venues/okx/symbol'
import {
  INSTRUMENTS_PATH,
  OKX_QUOTE_ASSET,
  publicRequest,
  SPOT_INST_TYPE,
} from '@/trading/venues/okx/transport'

const TICKERS_PATH = '/api/v5/market/tickers'
const CRYPTO_MARKET = marketRef('crypto')

/** Every spot instrument OKX lists against the currency it settles in, and what it last traded at,
 *  one call each. Both endpoints are public, so a venue holding no credentials still answers them.
 *  Quoted pairs are filtered rather than folded: one base carries a different floor against each
 *  quote, and only the pair this venue trades sizes what it holds. */
export function createOkxCatalog(): VenueCatalog {
  return {
    async listInstruments(signal: AbortSignal): Promise<readonly VenueInstrument[]> {
      const rows = await publicRequest(INSTRUMENTS_PATH, { instType: SPOT_INST_TYPE }, signal)

      return rows.flatMap(toVenueInstrument)
    },

    async listPrices(signal: AbortSignal): Promise<ReadonlyMap<Ticker, number>> {
      const rows = await publicRequest(TICKERS_PATH, { instType: SPOT_INST_TYPE }, signal)
      const prices = new Map<Ticker, number>()

      for (const row of rows) {
        const base = toTicker(row.instId ?? '')
        const last = Number(row.last)

        if (base !== undefined && isTickerShape(base) && Number.isFinite(last) && last > 0) {
          prices.set(ticker(base), last)
        }
      }

      return prices
    },
  }
}

/** One row or none: a pair settling in anything else, an unreadable floor, or a base asset no
 *  ticker can name is a row this venue cannot size, and a row it cannot size is not one it can be
 *  asked to trade. */
function toVenueInstrument(row: OkxRow): readonly VenueInstrument[] {
  const minimumSize = Number(row.minSz)
  const base = row.baseCcy

  if (
    row.quoteCcy !== OKX_QUOTE_ASSET ||
    !Number.isFinite(minimumSize) ||
    minimumSize <= 0 ||
    base === undefined ||
    !isTickerShape(base)
  ) {
    return []
  }

  return [{ ticker: ticker(base), market: CRYPTO_MARKET, minimumSize }]
}
