// Source class: free, keyless. The last ranked board, capped at the 100 rows the provider serves in
// one request — short of the resolution window, so it covers the ranks that carry a screen rather
// than the whole of it. Every number arrives as a string.
import { z } from 'zod'

import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { BoardRow, BoardSpec } from '@/trading/sources/adapters/crypto-board'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceRequest } from '@/trading/sources/types'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createCryptoBoard } from '@/trading/sources/adapters/crypto-board'

export const COINLORE_DEFAULT_ENDPOINT = 'https://api.coinlore.net'

const COINLORE_ID = 'coinlore'
const COINLORE_SOURCE = sourceId(COINLORE_ID)

/** What one request returns; asking for more is answered with the same hundred. */
const MAXIMUM_TICKERS = 100

const TICKERS = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      symbol: z.string().min(1),
      rank: z.number(),
      price_usd: z.string(),
      market_cap_usd: z.string(),
      volume24: z.union([z.number(), z.string()]),
      percent_change_24h: z.string().nullish(),
      percent_change_7d: z.string().nullish(),
    })
  ),
})

export function createCoinLoreSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [createCryptoBoard(options, BOARD).marketCap]
}

const BOARD: BoardSpec = {
  id: COINLORE_ID,
  request: tickersRequest,
  parse: (raw) => TICKERS.parse(raw).data.map(toBoardRow),
  resolutionRankLimit: MAXIMUM_TICKERS,
  defaultRowCount: MAXIMUM_TICKERS,
}

/** The board publishes no observation time, so the fetch stands as one — a coin trading
 *  continuously and priced now was priced now. */
function toBoardRow(row: z.infer<typeof TICKERS>['data'][number]): BoardRow {
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    rank: row.rank,
    priceUsd: numeric(row.price_usd),
    marketCapUsd: numeric(row.market_cap_usd),
    volumeUsd: numeric(row.volume24),
    changePct: numeric(row.percent_change_24h),
    change7dPct: numeric(row.percent_change_7d),
  }
}

function numeric(raw: string | number | null | undefined): number | null {
  const parsed = typeof raw === 'number' ? raw : Number(raw)

  return raw === null || raw === undefined || raw === '' || !Number.isFinite(parsed) ? null : parsed
}

function tickersRequest(signal: AbortSignal): SourceRequest {
  return {
    sourceId: COINLORE_SOURCE,
    path: '/api/tickers/',
    query: { start: '0', limit: String(MAXIMUM_TICKERS) },
    signal,
  }
}
