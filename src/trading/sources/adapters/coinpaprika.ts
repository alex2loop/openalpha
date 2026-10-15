// Source class: free, keyless. The whole ranked board in one request and no symbol lookup, so a
// coin past the window falls to the next provider. Metered at 20,000 calls a month per IP and 10 a
// second; one board read an hour is far inside both.
import { z } from 'zod'

import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { BoardRow, BoardSpec } from '@/trading/sources/adapters/crypto-board'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceRequest } from '@/trading/sources/types'
import { sourceId } from '@/trading/kernel/source/source-id'
import { boardObservedAt, createCryptoBoard } from '@/trading/sources/adapters/crypto-board'

export const COINPAPRIKA_DEFAULT_ENDPOINT = 'https://api.coinpaprika.com/v1'

const COINPAPRIKA_ID = 'coinpaprika'
const COINPAPRIKA_SOURCE = sourceId(COINPAPRIKA_ID)
const QUOTE_CURRENCY = 'USD'
/** The provider lists two thousand ranked assets; the resolution window is what the screen reads. */
const MAXIMUM_TICKERS = 750
const DEFAULT_ROW_COUNT = 100

const QUOTE = z.object({
  price: z.number(),
  volume_24h: z.number(),
  market_cap: z.number(),
  percent_change_24h: z.number().nullish(),
  percent_change_7d: z.number().nullish(),
})

const TICKER = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  symbol: z.string().min(1),
  rank: z.number(),
  last_updated: z.string(),
  quotes: z.object({ [QUOTE_CURRENCY]: QUOTE }),
})

const TICKERS = z.array(TICKER)

export function createCoinPaprikaSources(
  options: SourceAdapterOptions
): readonly RegisteredSource[] {
  return [createCryptoBoard(options, BOARD).marketCap]
}

/** No `lookup`: the provider's per-asset path takes its own id, and `BoardSpec.lookup` is asked by
 *  symbol. A coin past the window falls to the next provider on the route. */
const BOARD: BoardSpec = {
  id: COINPAPRIKA_ID,
  request: tickersRequest,
  parse: (raw) => TICKERS.parse(raw).map(toBoardRow),
  resolutionRankLimit: MAXIMUM_TICKERS,
  defaultRowCount: DEFAULT_ROW_COUNT,
}

function toBoardRow(row: z.infer<typeof TICKER>): BoardRow {
  const quote = row.quotes[QUOTE_CURRENCY]

  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    rank: row.rank,
    priceUsd: quote.price,
    marketCapUsd: quote.market_cap,
    volumeUsd: quote.volume_24h,
    changePct: quote.percent_change_24h ?? null,
    change7dPct: quote.percent_change_7d ?? null,
    ...boardObservedAt(row.last_updated),
  }
}

function tickersRequest(signal: AbortSignal): SourceRequest {
  return {
    sourceId: COINPAPRIKA_SOURCE,
    path: '/tickers',
    query: { quotes: QUOTE_CURRENCY, limit: String(MAXIMUM_TICKERS) },
    signal,
  }
}
