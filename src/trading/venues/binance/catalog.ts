import type { Ticker } from '@/trading/kernel/instrument'
import type { VenueCatalog, VenueInstrument } from '@/trading/kernel/venue/catalog'
import { isTickerShape, marketRef, ticker } from '@/trading/kernel/instrument'
import {
  EXCHANGE_INFO_PATH,
  EXCHANGE_INFO_ROWS,
  minimumSizeOf,
  parseSymbolInfo,
  toSymbolFilters,
} from '@/trading/venues/binance/filters'
import { listSymbolPrices } from '@/trading/venues/binance/price'
import { toBinanceTicker } from '@/trading/venues/binance/symbol'
import { BINANCE_QUOTE_ASSET, binancePublicRequest } from '@/trading/venues/binance/transport'

const TRADING_STATUS = 'TRADING'
const SPOT_PERMISSION = 'SPOT'
// The whole spot listing is about 2.4 MB even without permission sets, past the client's default.
const EXCHANGE_INFO_MAXIMUM_BYTES = 8 * 1024 * 1024
// What Binance lists is the live board, even in demo mode: the demo book prices its own test market.
const MARKET_DATA_SIMULATED = false
const CRYPTO_MARKET = marketRef('crypto')

/** Public reads, so a venue holding no credentials still answers them. */
export function createBinanceCatalog(): VenueCatalog {
  return {
    async listInstruments(signal: AbortSignal): Promise<readonly VenueInstrument[]> {
      const [info, prices] = await Promise.all([
        binancePublicRequest(MARKET_DATA_SIMULATED, {
          path: EXCHANGE_INFO_PATH,
          params: {
            permissions: SPOT_PERMISSION,
            symbolStatus: TRADING_STATUS,
            showPermissionSets: 'false',
          },
          schema: EXCHANGE_INFO_ROWS,
          signal,
          maxBytes: EXCHANGE_INFO_MAXIMUM_BYTES,
        }),
        listSymbolPrices(MARKET_DATA_SIMULATED, signal),
      ])

      return (info?.symbols ?? []).flatMap((raw) => toVenueInstrument(raw, prices))
    },

    async listPrices(signal: AbortSignal): Promise<ReadonlyMap<Ticker, number>> {
      const prices = new Map<Ticker, number>()

      for (const [symbol, price] of await listSymbolPrices(MARKET_DATA_SIMULATED, signal)) {
        const base = toBinanceTicker(symbol)

        if (base !== undefined && isTickerShape(base)) {
          prices.set(ticker(base), price)
        }
      }

      return prices
    },
  }
}

/** One row or none. A row in a shape this cannot read, a pair settling in anything else, one no
 *  order can be rounded onto, or a base asset no ticker can name (Binance lists non-ASCII ones) is
 *  not a row this venue can trade. Every row is crypto. */
function toVenueInstrument(
  raw: unknown,
  prices: ReadonlyMap<string, number>
): readonly VenueInstrument[] {
  const row = parseSymbolInfo(raw)
  const filters = row === undefined ? undefined : toSymbolFilters(row)

  if (
    row === undefined ||
    row.quoteAsset !== BINANCE_QUOTE_ASSET ||
    !row.isSpotTradingAllowed ||
    !isTickerShape(row.baseAsset) ||
    filters === undefined
  ) {
    return []
  }

  return [
    {
      ticker: ticker(row.baseAsset),
      market: CRYPTO_MARKET,
      minimumSize: minimumSizeOf(filters, prices.get(row.symbol)),
    },
  ]
}
