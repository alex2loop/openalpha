import { z } from 'zod'

import type { Ticker } from '@/trading/kernel/instrument'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ttlCache } from '@/core/utils/collections'
import { ticker } from '@/trading/kernel/instrument'
import { createSharedFlight, type SharedFlight } from '@/trading/kernel/shared-flight'
import { SEC_CREDENTIAL, SEC_ID, toPaddedCik } from '@/trading/sources/adapters/sec/client'
import { dropInvalid, parseRow } from '@/trading/sources/rows/normalization'

/** Ticker to ten-digit company id. SEC writes a class share with a dash (`BRK-B`); the market's
 *  own spelling is the dotted one. */
export type SecTickerMap = ReadonlyMap<Ticker, string>

const SEC_TICKER_MAP_TTL_MS = 86_400_000
const TICKER_MAP_KEY = 'tickers'

const TICKER_ROW = z.object({ cik_str: z.number(), ticker: z.string().min(1) })

export type TickerMapReader = (signal: AbortSignal) => Promise<SourceFetchOutcome<SecTickerMap>>

interface CachedMap {
  readonly value: SecTickerMap
  readonly fetchedAt: number
}

/** The map changes when a company lists or renames; one copy serves a day. Callers arriving on a
 *  cold cache share the one download, which an abort of any single caller does not cancel. */
export function createTickerMapReader(http: SourceHttp): TickerMapReader {
  const cache = ttlCache<string, CachedMap>(SEC_TICKER_MAP_TTL_MS, 1)
  let pending: SharedFlight<SourceFetchOutcome<SecTickerMap>> | undefined

  async function load(signal: AbortSignal): Promise<SourceFetchOutcome<SecTickerMap>> {
    const outcome = await readTickerMap(http, signal)

    if (outcome.kind === 'ok') {
      cache.set(TICKER_MAP_KEY, { value: outcome.value, fetchedAt: outcome.fetchedAt })
    }

    return outcome
  }

  return (signal) => {
    const held = cache.get(TICKER_MAP_KEY)

    if (held !== undefined) {
      return Promise.resolve({ kind: 'ok', value: held.value, fetchedAt: held.fetchedAt })
    }

    if (pending?.live !== true) {
      const started = createSharedFlight(load)
      const release = (): void => {
        if (pending === started) {
          pending = undefined
        }
      }

      pending = started
      started.work.then(release, release)
    }

    return pending.attach(signal)
  }
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
