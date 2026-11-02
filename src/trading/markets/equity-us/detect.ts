import type { InstrumentMatch, InstrumentSearchRequest, Ticker } from '@/trading/kernel/instrument'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketDetection, TickerCandidacy } from '@/trading/markets/types'
import { ETF_KIND } from '@/trading/kernel/instrument'
import { US_MARKET_REF } from '@/trading/markets/equity-us/policy'

/** One to five letters, with an optional single-letter class (`BRK.B`). */
const US_TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/

/** Cheap and pure: it only rules out shapes the US never lists. Everything else is `possible` and
 *  the stored universe in `detect` decides. */
export function usCandidacy(candidate: Ticker): TickerCandidacy {
  return US_TICKER_RE.test(candidate) ? 'possible' : 'impossible'
}

interface DetectOptions {
  readonly ticker: Ticker
  readonly signal: AbortSignal
}

/** Detection is a lookup in the stored universe, not a source call: the refresh already validated
 *  the whole scope, and only an active record resolves. A halted or delisted one is a no-match
 *  carrying the status, because the universe answered the tradeability question. */
export async function detect(deps: MarketDeps, options: DetectOptions): Promise<MarketDetection> {
  const record = await deps.marketDataStore.findInstrument({
    instrument: { market: US_MARKET_REF, ticker: options.ticker },
    signal: options.signal,
  })

  if (record === null) {
    return listingMiss(deps, options.signal)
  }

  if (record.status !== 'active') {
    return {
      kind: 'no-match',
      listingChecked: true,
      caveats: [
        {
          code: 'market.ticker-not-active',
          detail: { ticker: options.ticker, market: US_MARKET_REF, status: record.status },
        },
      ],
    }
  }

  // A fund's provider sector names the vehicle, not the basket.
  const sector = record.kind === ETF_KIND ? undefined : record.sector

  return {
    kind: 'match',
    instrument: record.instrument,
    name: record.name,
    ...(sector === undefined ? {} : { sector }),
    instrumentKind: record.kind,
  }
}

/** Active listings only: a halted or delisted name cannot be priced or traded. */
export async function search(
  deps: MarketDeps,
  options: InstrumentSearchRequest
): Promise<readonly InstrumentMatch[]> {
  const records = await deps.marketDataStore.listInstruments({
    market: US_MARKET_REF,
    status: 'active',
    search: { query: options.query, limit: options.limit },
    signal: options.signal,
  })

  return records.map((record) => ({
    instrument: record.instrument,
    name: record.name,
    instrumentKind: record.kind,
  }))
}

/** A miss over a populated listing is a real check; over an empty one it is a cold or failed
 *  refresh, not a market that does not list the name. Asked only on the miss path. */
async function listingMiss(deps: MarketDeps, signal: AbortSignal): Promise<MarketDetection> {
  const populated = await deps.marketDataStore.hasInstruments({ market: US_MARKET_REF, signal })

  return populated
    ? { kind: 'no-match', listingChecked: true }
    : { kind: 'no-match', caveats: [{ code: 'market-data.universe-empty' }] }
}
