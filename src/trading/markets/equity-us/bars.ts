import type { BarsRequest, InstrumentRequest } from '@/trading/kernel/market/market-capability'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { SourceContext, SourceResult } from '@/trading/kernel/source/source-result'
import type { BarWindow } from '@/trading/markets/bars'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketManifest } from '@/trading/markets/types'
import { mapSourceValue } from '@/trading/kernel/source/source-result'
import { settledBars } from '@/trading/markets/bars'
import { US_EVIDENCE_SESSIONS, US_MARKET_REF } from '@/trading/markets/equity-us/policy'

export function runUsBars(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: BarsRequest
): Promise<SourceResult<readonly Candle[]>> {
  return settledBars(deps, request, {
    calendar: manifest.calendar,
    defaultSessions: US_EVIDENCE_SESSIONS,
    fetch: async (window) =>
      mapSourceValue(await sourceBars(deps, request, window), (candles) =>
        candles.filter((candle) => manifest.calendar.isTradingDay(candle.at))
      ),
  })
}

async function sourceBars(
  deps: MarketDeps,
  request: InstrumentRequest,
  window: BarWindow
): Promise<SourceResult<readonly Candle[]>> {
  return deps.sources.resolve({
    kind: 'bars',
    context: {
      market: US_MARKET_REF,
      instrument: request.instrument,
      fromDay: window.fromDay,
      toDay: window.toDay,
      limit: window.sessions,
      ...(await instrumentKindOf(deps, request)),
    },
    signal: request.signal,
  })
}

/** The stored record is the only thing that knows whether a ticker is an index, a fund or a share:
 *  Nasdaq serves each from its own asset class. A name absent from the scope leaves the field
 *  unset, and the provider treats it as a stock. */
export async function instrumentKindOf(
  deps: MarketDeps,
  request: InstrumentRequest
): Promise<Pick<SourceContext, 'instrumentKind'>> {
  const record = await deps.marketDataStore.findInstrument({
    instrument: request.instrument,
    signal: request.signal,
  })

  return record === null ? {} : { instrumentKind: record.kind }
}
