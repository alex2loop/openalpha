// Source class: free and keyless. The public subset serves the whole ranked window in one request,
// which is what the crypto market-cap route leads with. It publishes no per-symbol row without a
// key, so a coin past the window is left to the next provider rather than looked up.
import { z } from 'zod'

import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { BoardRow, BoardSpec } from '@/trading/sources/adapters/crypto-board'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceRequest } from '@/trading/sources/types'
import { sourceId } from '@/trading/kernel/source/source-id'
import { boardObservedAt, createCryptoBoard } from '@/trading/sources/adapters/crypto-board'

export const COINMARKETCAP_DEFAULT_ENDPOINT = 'https://pro-api.coinmarketcap.com'

const COINMARKETCAP_ID = 'coinmarketcap'
const COINMARKETCAP_SOURCE = sourceId(COINMARKETCAP_ID)

/** The keyless prefix. A key moves the same endpoint to `/v1` and changes nothing else about the
 *  rows, so adopting one later is this constant and a credential header. */
const LISTINGS_PATH = '/public-api/v1/cryptocurrency/listings/latest'
const QUOTE_CURRENCY = 'USD'
const DEFAULT_ROW_COUNT = 100
/** The window `resolutionRankLimit` asks for, answered in a single request — the whole reason this
 *  leads the route. */
const MAXIMUM_TICKERS = 750
/** Rank-ordered from the top; the listing is one-based. */
const FIRST_RANK = 1

const LISTINGS = z.object({
  data: z.array(
    z.object({
      id: z.number(),
      name: z.string().min(1),
      symbol: z.string().min(1),
      cmc_rank: z.number().nullable(),
      last_updated: z.string().min(1),
      quote: z.object({
        USD: z.object({
          price: z.number().nullable(),
          market_cap: z.number().nullable(),
          volume_24h: z.number().nullable(),
          percent_change_24h: z.number().nullish(),
          percent_change_7d: z.number().nullish(),
        }),
      }),
    })
  ),
})

export function createCoinMarketCapSources(
  options: SourceAdapterOptions
): readonly RegisteredSource[] {
  return [createCryptoBoard(options, BOARD).marketCap]
}

const BOARD: BoardSpec = {
  id: COINMARKETCAP_ID,
  request: listingsRequest,
  parse: (raw) => LISTINGS.parse(raw).data.map(toBoardRow),
  resolutionRankLimit: MAXIMUM_TICKERS,
  defaultRowCount: DEFAULT_ROW_COUNT,
}

function toBoardRow(row: z.infer<typeof LISTINGS>['data'][number]): BoardRow {
  const { USD } = row.quote

  return {
    id: String(row.id),
    name: row.name,
    symbol: row.symbol,
    rank: row.cmc_rank,
    priceUsd: USD.price,
    marketCapUsd: USD.market_cap,
    volumeUsd: USD.volume_24h,
    changePct: USD.percent_change_24h ?? null,
    change7dPct: USD.percent_change_7d ?? null,
    ...boardObservedAt(row.last_updated),
  }
}

function listingsRequest(signal: AbortSignal): SourceRequest {
  return {
    sourceId: COINMARKETCAP_SOURCE,
    path: LISTINGS_PATH,
    query: {
      start: String(FIRST_RANK),
      limit: String(MAXIMUM_TICKERS),
      convert: QUOTE_CURRENCY,
    },
    signal,
  }
}
