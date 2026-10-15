import { z } from 'zod'

import { toBinancePair } from '@/trading/venues/binance/symbol'
import {
  binancePublicRequest,
  DECIMAL,
  UNKNOWN_SYMBOL_CODES,
} from '@/trading/venues/binance/transport'

const TICKER_PRICE_PATH = '/api/v3/ticker/price'
const TICKER_PRICE = z.object({ symbol: z.string(), price: DECIMAL })
const TICKER_PRICES = z.array(TICKER_PRICE)

/** Undefined where Binance lists no such pair. A network failure still throws: "not listed" and
 *  "could not ask" are different answers. */
export async function fetchSymbolPrice(
  simulated: boolean,
  symbol: string,
  signal: AbortSignal
): Promise<number | undefined> {
  const row = await binancePublicRequest(simulated, {
    path: TICKER_PRICE_PATH,
    params: { symbol },
    schema: TICKER_PRICE,
    signal,
    acceptedCodes: UNKNOWN_SYMBOL_CODES,
  })

  return row !== undefined && row.price > 0 ? row.price : undefined
}

export function fetchAssetPrice(
  simulated: boolean,
  asset: string,
  signal: AbortSignal
): Promise<number | undefined> {
  return fetchSymbolPrice(simulated, toBinancePair(asset), signal)
}

/** Every pair's last price in one call, keyed by Binance's own symbol. */
export async function listSymbolPrices(
  simulated: boolean,
  signal: AbortSignal
): Promise<ReadonlyMap<string, number>> {
  const rows = await binancePublicRequest(simulated, {
    path: TICKER_PRICE_PATH,
    schema: TICKER_PRICES,
    signal,
  })

  return new Map((rows ?? []).filter((row) => row.price > 0).map((row) => [row.symbol, row.price]))
}
