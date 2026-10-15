// Source class: keyed, Demo plan of 10,000 calls a month. Leads the market-cap board for its rank
// and seven-day change, and prices a settlement coin in a fiat; the quota is spent on sweeps and
// one rate read a run.
import { z } from 'zod'

import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { BoardRow, BoardSpec } from '@/trading/sources/adapters/crypto-board'
import type { CryptoFxReading, CryptoFxSpec } from '@/trading/sources/adapters/crypto-fx'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceRequest } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'
import { sourceId } from '@/trading/kernel/source/source-id'
import { boardObservedAt, createCryptoBoard } from '@/trading/sources/adapters/crypto-board'
import { createCryptoFx } from '@/trading/sources/adapters/crypto-fx'
import { fromCodeTable } from '@/trading/sources/rows/normalization'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

export const COINGECKO_DEFAULT_ENDPOINT = 'https://api.coingecko.com/api/v3'

const COINGECKO_ID = 'coingecko'
const COINGECKO_SOURCE = sourceId(COINGECKO_ID)
const CREDENTIAL_HEADER = 'x-cg-demo-api-key'
const VS_CURRENCY = 'usd'
const DEFAULT_ROW_COUNT = 100
/** The most one page returns, and the window past which a symbol claims no coin. */
const MAXIMUM_PER_PAGE = 250
/** The one change window the sweep asks for beyond the day: what the screen chooses its board on. */
const SWEEP_CHANGE_WINDOW = '7d'
const SIMPLE_PRICE_PATH = '/simple/price'
/** The coins this source can price in a fiat, by the id CoinGecko knows them under. */
const FX_COIN_IDS: Readonly<Record<string, string>> = Object.freeze({ USDT: 'tether' })
/** The one key in a priced row that is not a price. */
const LAST_UPDATED_KEY = 'last_updated_at'

const MARKETS = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    symbol: z.string().min(1),
    current_price: z.number().nullable(),
    market_cap: z.number().nullable(),
    total_volume: z.number().nullable(),
    market_cap_rank: z.number().nullable(),
    price_change_percentage_24h: z.number().nullish(),
    price_change_percentage_7d_in_currency: z.number().nullish(),
    last_updated: z.string().min(1),
  })
)

/** Prices keyed by coin id, then by the lowercase fiat code the request asked for, with the stamp
 *  sharing that inner object. */
const SIMPLE_PRICE = z.record(z.string(), z.record(z.string(), z.number()))

export function createCoinGeckoSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [createCryptoBoard(options, BOARD).marketCap, createCryptoFx(options, FX)]
}

const BOARD: BoardSpec = {
  id: COINGECKO_ID,
  request: marketsRequest,
  parse: (raw) => MARKETS.parse(raw).map(toBoardRow),
  resolutionRankLimit: MAXIMUM_PER_PAGE,
  defaultRowCount: DEFAULT_ROW_COUNT,
  lookup: symbolRequest,
}

function toBoardRow(row: z.infer<typeof MARKETS>[number]): BoardRow {
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    rank: row.market_cap_rank,
    priceUsd: row.current_price,
    marketCapUsd: row.market_cap,
    volumeUsd: row.total_volume,
    changePct: row.price_change_percentage_24h ?? null,
    change7dPct: row.price_change_percentage_7d_in_currency ?? null,
    ...boardObservedAt(row.last_updated),
  }
}

function marketsRequest(signal: AbortSignal): SourceRequest {
  return {
    sourceId: COINGECKO_SOURCE,
    path: '/coins/markets',
    query: {
      vs_currency: VS_CURRENCY,
      order: 'market_cap_desc',
      per_page: String(MAXIMUM_PER_PAGE),
      page: '1',
      price_change_percentage: SWEEP_CHANGE_WINDOW,
    },
    credential: { kind: 'header', name: CREDENTIAL_HEADER },
    signal,
  }
}

/** One named symbol, for a coin ranked past the page the board reads. Same endpoint and same row
 *  shape as the board, so a coin outside the listing is quoted exactly as one inside it. */
function symbolRequest(symbol: string, signal: AbortSignal): SourceRequest {
  return {
    sourceId: COINGECKO_SOURCE,
    path: '/coins/markets',
    query: {
      vs_currency: VS_CURRENCY,
      symbols: symbol.toLowerCase(),
      price_change_percentage: SWEEP_CHANGE_WINDOW,
    },
    credential: { kind: 'header', name: CREDENTIAL_HEADER },
    signal,
  }
}

const FX: CryptoFxSpec = {
  id: COINGECKO_SOURCE,
  coinId: (base) => fromCodeTable(FX_COIN_IDS, base),
  request: (input) => ({
    path: SIMPLE_PRICE_PATH,
    query: {
      ids: input.coinId,
      vs_currencies: input.fiat.toLowerCase(),
      include_last_updated_at: 'true',
    },
    credential: { kind: 'header', name: CREDENTIAL_HEADER },
    ...QUOTE_ATTEMPT_LIMITS,
  }),
  parse: (raw) => toFxReading(SIMPLE_PRICE.parse(raw)),
}

/** The request names one coin and one fiat, so the payload carries one row holding one price.
 *  Reading both positionally is what lets the shared spec's `parse` stay context-free; a payload
 *  answering anything else is a bug rather than a rate. */
function toFxReading(payload: z.infer<typeof SIMPLE_PRICE>): CryptoFxReading {
  const [row, ...otherCoins] = Object.values(payload)

  if (row === undefined || otherCoins.length > 0) {
    throw new ValidationError('coingecko fx did not answer exactly one coin')
  }

  const [priced, ...otherRates] = Object.entries(row).filter(([key]) => key !== LAST_UPDATED_KEY)

  if (priced === undefined || otherRates.length > 0) {
    throw new ValidationError('coingecko fx did not answer exactly one rate')
  }

  const stamp = row[LAST_UPDATED_KEY]

  return {
    rate: priced[1],
    ...(stamp === undefined ? {} : { observedAt: stamp * MS_PER_SECOND }),
  }
}
