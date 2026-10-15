import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { NewsRequest } from '@/trading/kernel/market/market-capability'
import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { SourceContext, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import {
  CRYPTO_MARKET_REF,
  CRYPTO_REGION,
  CRYPTO_SEARCH_TOPIC,
} from '@/trading/markets/crypto/policy'

export async function cryptoNews(
  deps: MarketDeps,
  request: NewsRequest
): Promise<SourceResult<readonly NewsItem[]>> {
  const context = await newsContext(deps, request)

  return deps.sources.resolve({ kind: 'news', context, signal: request.signal })
}

/** No publisher covering this market indexes a symbol, so an instrument is asked for by name. A
 *  coin whose name cannot be read carries no terms and is answered by nobody — the market's own
 *  tape would otherwise come back stamped as that coin's coverage. */
async function newsContext(deps: MarketDeps, request: NewsRequest): Promise<SourceContext> {
  const scope = { market: CRYPTO_MARKET_REF, region: CRYPTO_REGION, limit: request.limit }
  const { instrument } = request

  if (instrument === undefined) {
    return scope
  }

  const subject = await subjectTerms(deps, instrument, request.signal)

  return subject.length === 0
    ? { ...scope, instrument }
    : { ...scope, instrument, searchSubject: subject, searchTopic: CRYPTO_SEARCH_TOPIC }
}

/** The listed name, off the board this market already resolves its tickers against: that snapshot
 *  is cached for the sweep's life, so naming a coin costs no request of its own. Name before
 *  ticker — the search reads them in order of how specific they are. */
async function subjectTerms(
  deps: MarketDeps,
  instrument: InstrumentRef,
  signal: AbortSignal
): Promise<readonly string[]> {
  const result = await deps.sources.resolve({
    kind: 'marketCap',
    context: { market: CRYPTO_MARKET_REF, instrument },
    signal,
  })
  const [record] = result.kind === 'available' ? result.value : []

  return record === undefined ? [] : [record.name, instrument.ticker]
}
