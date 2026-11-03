import type { NewsRequest } from '@/trading/kernel/market/market-capability'
import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { SourceContext, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import {
  US_MARKET_REF,
  US_MARKET_REGION,
  US_SEARCH_TOPIC,
} from '@/trading/markets/equity-us/policy'

export async function runUsNews(
  deps: MarketDeps,
  request: NewsRequest
): Promise<SourceResult<readonly NewsItem[]>> {
  return deps.sources.resolve({
    kind: 'news',
    context: await newsContext(deps, request),
    signal: request.signal,
  })
}

/** No publisher indexes a ticker, so an instrument is asked for by name and symbol. A name the
 *  store cannot read carries no terms and is answered by nobody. */
async function newsContext(deps: MarketDeps, request: NewsRequest): Promise<SourceContext> {
  const scope = { market: US_MARKET_REF, region: US_MARKET_REGION, limit: request.limit }
  const { instrument } = request

  if (instrument === undefined) {
    return scope
  }

  const record = await deps.marketDataStore.findInstrument({ instrument, signal: request.signal })

  return record === null
    ? { ...scope, instrument }
    : {
        ...scope,
        instrument,
        searchSubject: [record.name, instrument.ticker],
        searchTopic: US_SEARCH_TOPIC,
      }
}
