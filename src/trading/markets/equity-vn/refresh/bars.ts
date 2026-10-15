import type { InstrumentRequest } from '@/trading/kernel/market/market-capability'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { SourceContext, SourceResult } from '@/trading/kernel/source/source-result'
import type { BarWindow } from '@/trading/markets/bars'
import type { MarketDeps } from '@/trading/markets/deps'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'

/** VN's providers serve each instrument class from a different endpoint, so the class rides along;
 *  the window itself is whatever the shared read asked for. */
export async function sourceBars(
  deps: MarketDeps,
  request: InstrumentRequest,
  window: BarWindow
): Promise<SourceResult<readonly Candle[]>> {
  return deps.sources.resolve({
    kind: 'bars',
    context: {
      market: VN_MARKET_REF,
      instrument: request.instrument,
      fromDay: window.fromDay,
      toDay: window.toDay,
      limit: window.sessions,
      ...(await seriesClass(deps, request)),
    },
    signal: request.signal,
  })
}

/** The stored record is the only thing that knows whether a ticker is an index, a future, or a
 *  share. A name absent from the scope leaves the field unset, and the provider treats it as cash. */
export async function seriesClass(
  deps: MarketDeps,
  request: InstrumentRequest
): Promise<Pick<SourceContext, 'instrumentKind'>> {
  const record = await deps.marketDataStore.findInstrument({
    instrument: request.instrument,
    signal: request.signal,
  })

  return record === null ? {} : { instrumentKind: record.kind }
}
