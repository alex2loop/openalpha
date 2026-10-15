import type { BarsRequest } from '@/trading/kernel/market/market-capability'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { TradingCalendar } from '@/trading/markets/types'
import { settledBars } from '@/trading/markets/bars'
import { CRYPTO_EVIDENCE_SESSIONS, CRYPTO_MARKET_REF } from '@/trading/markets/crypto/policy'

export function cryptoBars(
  deps: MarketDeps,
  request: BarsRequest,
  calendar: TradingCalendar
): Promise<SourceResult<readonly Candle[]>> {
  return settledBars(deps, request, {
    calendar,
    defaultSessions: CRYPTO_EVIDENCE_SESSIONS,
    fetch: (window) =>
      deps.sources.resolve({
        kind: 'bars',
        context: {
          market: CRYPTO_MARKET_REF,
          instrument: request.instrument,
          fromDay: window.fromDay,
          toDay: window.toDay,
          limit: window.sessions,
        },
        signal: request.signal,
      }),
  })
}
