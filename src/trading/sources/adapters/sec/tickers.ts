import { z } from 'zod'

import type { Ticker } from '@/trading/kernel/instrument'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ticker } from '@/trading/kernel/instrument'
import { SEC_CREDENTIAL, SEC_ID, toPaddedCik } from '@/trading/sources/adapters/sec/client'
import { createCachedReader } from '@/trading/sources/cached-reader'
import { dropInvalid, parseRow } from '@/trading/sources/rows/normalization'

/** Ticker to ten-digit company id. SEC writes a class share with a dash (`BRK-B`); the market's
 *  own spelling is the dotted one. */
export type SecTickerMap = ReadonlyMap<Ticker, string>

const SEC_TICKER_MAP_TTL_MS = 86_400_000
const TICKER_MAP_KEY = 'tickers'

const TICKER_ROW = z.object({ cik_str: z.number(), ticker: z.string().min(1) })

export type TickerMapReader = (signal: AbortSignal) => Promise<SourceFetchOutcome<SecTickerMap>>

/** The map changes when a company lists or renames; one copy serves a day. */
export function createTickerMapReader(http: SourceHttp): TickerMapReader {
  const read = createCachedReader<string, SecTickerMap>({
    ttlMs: SEC_TICKER_MAP_TTL_MS,
    maxEntries: 1,
    load: (_key, signal) => readTickerMap(http, signal),
  })

  return (signal) => read(TICKER_MAP_KEY, signal)
}

/** `company_tickers.json` is an object keyed by position, not an array. */
function readTickerMap(
  http: SourceHttp,
  signal: AbortSignal
): Promise<SourceFetchOutcome<SecTickerMap>> {
  return http.getJson(
    { sourceId: SEC_ID, path: '/files/company_tickers.json', credential: SEC_CREDENTIAL, signal },
    (raw) => toTickerMap(z.record(z.string(), z.unknown()).parse(raw))
  )
}

function toTickerMap(rows: Readonly<Record<string, unknown>>): SecTickerMap {
  const entries = dropInvalid(Object.values(rows), (raw) => {
    const row = parseRow(TICKER_ROW, raw, 'sec ticker')

    return [ticker(row.ticker.replaceAll('-', '.')), toPaddedCik(row.cik_str)] as const
  })

  // The first listing of a name wins: SEC lists a dual-class issuer's classes under one id.
  const map = new Map<Ticker, string>()

  for (const [code, cik] of entries) {
    if (!map.has(code)) {
      map.set(code, cik)
    }
  }

  return map
}
