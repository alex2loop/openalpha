import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentMatch, InstrumentSearchRequest, Ticker } from '@/trading/kernel/instrument'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketDetection, TickerCandidacy } from '@/trading/markets/types'
import { ETF_KIND } from '@/trading/kernel/instrument'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'

/** VN listings are 3-letter share codes, longer fund codes (FUEVFVND), index codes, and dated
 *  future codes. Nothing here is a dot- or dash-bearing symbol, so those are exact rejections. */
const VN_TICKER_RE = /^[A-Z][A-Z0-9]{2,9}$/

/** Cheap and pure: it only rules out shapes VN never lists. Everything else is `possible` and the
 *  universe lookup in `detect` decides — guessing from the shape alone would claim tickers that
 *  are not listed here. */
export function candidacy(candidate: Ticker): TickerCandidacy {
  return VN_TICKER_RE.test(candidate) ? 'possible' : 'impossible'
}

interface DetectOptions {
  readonly ticker: Ticker
  readonly signal: AbortSignal
}

/** Detection is a lookup in the stored universe, not a source call: the refresh already validated
 *  the whole scope, and a name absent from it is a name this market cannot price. Tradeability is
 *  the screen's `status: 'active'` rule, so only an active record resolves — a halted, delisted, or
 *  unknown one is a no-match carrying the status, because the universe answered the tradeability
 *  question and reporting it as unlisted would throw that answer away. */
export async function detect(deps: MarketDeps, options: DetectOptions): Promise<MarketDetection> {
  const record = await deps.marketDataStore.findInstrument({
    instrument: { market: VN_MARKET_REF, ticker: options.ticker },
    signal: options.signal,
  })

  if (record === null) {
    return { kind: 'no-match', caveats: await coldUniverseCaveats(deps, options.signal) }
  }

  if (record.status !== 'active') {
    return {
      kind: 'no-match',
      caveats: [
        {
          code: 'market.ticker-not-active',
          detail: { ticker: options.ticker, market: VN_MARKET_REF, status: record.status },
        },
      ],
    }
  }

  // A fund's provider sector names the vehicle, not the basket, the same reading the book fold
  // takes. Passed through, it measures a fund against an operating sector's headroom and can cap
  // the order there, while the holding it creates never counts toward that sector's weight.
  const sector = record.kind === ETF_KIND ? undefined : record.sector

  return {
    kind: 'match',
    instrument: record.instrument,
    name: record.name,
    ...(sector === undefined ? {} : { sector }),
    ...(record.indexTier === undefined ? {} : { indexTier: record.indexTier }),
    ...(record.kind === undefined ? {} : { instrumentKind: record.kind }),
  }
}

/** Active listings only: a halted or delisted name cannot be priced or traded. */
export async function search(
  deps: MarketDeps,
  options: InstrumentSearchRequest
): Promise<readonly InstrumentMatch[]> {
  const records = await deps.marketDataStore.listInstruments({
    market: VN_MARKET_REF,
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

/** The same distinction `screen` draws: a published-but-empty universe is a cold or failed refresh,
 *  not a market that does not list the name. Asked only on the miss path, so a resolved ticker
 *  never pays for it. */
async function coldUniverseCaveats(
  deps: MarketDeps,
  signal: AbortSignal
): Promise<readonly Caveat[]> {
  const populated = await deps.marketDataStore.hasInstruments({ market: VN_MARKET_REF, signal })

  return populated ? [] : [{ code: 'market-data.universe-empty' }]
}
