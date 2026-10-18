import type { Caveat } from '@/trading/kernel/caveat'
import type { Ticker } from '@/trading/kernel/instrument'
import type { MarketCapRecord } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type {
  DetectInstrumentOptions,
  MarketDetection,
  TickerCandidacy,
} from '@/trading/markets/types'
import {
  CRYPTO_MARKET_REF,
  CRYPTO_SYMBOL_RE,
  EXCLUDED_TICKERS,
  MAXIMUM_RESOLUTION_RANK,
  STABLECOIN_TICKERS,
} from '@/trading/markets/crypto/policy'
import { isTokenizedEquity, loadUniverseBoard } from '@/trading/markets/crypto/universe'
import { CAVEAT_SUBJECT_SEPARATOR } from '@/trading/render/format'

/** Pure and synchronous, so a ticker this market could never list never reaches CoinGecko. Pegs and
 *  wrapped mirrors are excluded here rather than at the screen because they are not candidates for
 *  a suggestion under any request, qualified or not. */
export function cryptoCandidacy(candidate: Ticker): TickerCandidacy {
  if (!CRYPTO_SYMBOL_RE.test(candidate)) {
    return 'impossible'
  }

  return STABLECOIN_TICKERS.has(candidate) || EXCLUDED_TICKERS.has(candidate)
    ? 'impossible'
    : 'possible'
}

/** Resolution is by market-cap rank inside the ceiling. Several tokens legitimately share a symbol,
 *  and picking the higher-ranked one silently is how a suggestion ends up about a different asset
 *  than the user asked for — so a collision refuses, naming the coins that collide. Cross-*market*
 *  ambiguity is the registry's to report; a collision inside crypto is this market's own. */
export async function detectCrypto(
  deps: MarketDeps,
  options: DetectInstrumentOptions
): Promise<MarketDetection> {
  const result = await loadUniverseBoard(deps, options.signal)

  if (result.kind === 'unavailable') {
    return undetected(result.caveats, options.ticker)
  }

  const matches = result.value.filter(
    (record) =>
      record.instrument.ticker === options.ticker && record.rank <= MAXIMUM_RESOLUTION_RANK
  )

  if (matches.length > 1) {
    return {
      kind: 'no-match',
      caveats: [
        {
          code: 'market.ticker-shared',
          detail: {
            ticker: options.ticker,
            market: CRYPTO_MARKET_REF,
            names: matches.map((record) => record.name).join(CAVEAT_SUBJECT_SEPARATOR),
          },
        },
      ],
    }
  }

  const [first] = matches

  return first ? matched(first) : detectByName(deps, options)
}

/** The board is the top of the market, not the whole of it, and a coin past its window is still one
 *  the operator holds. Reached only when the listing claimed the ticker for nobody. */
async function detectByName(
  deps: MarketDeps,
  options: DetectInstrumentOptions
): Promise<MarketDetection> {
  const result = await deps.sources.resolve({
    kind: 'marketCap',
    context: {
      market: CRYPTO_MARKET_REF,
      instrument: { market: CRYPTO_MARKET_REF, ticker: options.ticker },
    },
    signal: options.signal,
  })

  // Only a provider that could not answer leaves the question open. Every other reason is the
  // sources settling on "no such coin", which is cacheable as unknown.
  if (result.kind === 'unavailable') {
    return result.reason === 'failed'
      ? undetected(result.caveats, options.ticker)
      : { kind: 'no-match' }
  }

  const [record] = result.value

  return record ? matched(record) : { kind: 'no-match' }
}

/** Both paths end here, so the one asset class a crypto listing can hide is refused once. A
 *  tokenized share resolves cleanly on every provider and would be scored on funding and crowding,
 *  which argue nothing about the company. */
function matched(record: MarketCapRecord): MarketDetection {
  if (isTokenizedEquity(record)) {
    return {
      kind: 'no-match',
      caveats: [
        {
          code: 'market.tokenized-equity',
          detail: { ticker: record.instrument.ticker, name: record.name },
        },
      ],
    }
  }

  return { kind: 'match', instrument: record.instrument, name: record.name }
}

/** A provider that did not answer is "not today", not "not listed". Without the caveat the registry
 *  reports the ticker as unknown and caches that, so a repaired provider stays invisible. */
function undetected(caveats: readonly Caveat[], ticker: Ticker): MarketDetection {
  return {
    kind: 'no-match',
    caveats: [
      ...caveats,
      { code: 'market.detector-failed', detail: { ticker, market: CRYPTO_MARKET_REF } },
    ],
  }
}
