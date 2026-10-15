import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketDeps } from '@/trading/markets/deps'
import {
  INTERBANK_TENORS,
  interbankSeriesId,
  REDISCOUNT_SERIES_ID,
  REFINANCING_SERIES_ID,
} from '@/trading/kernel/market/policy-rates'
import { VN_MARKET_REGION } from '@/trading/markets/equity-vn/policy'

interface PolicyRatesRefresh {
  readonly deps: MarketDeps
  readonly asOf: TradingDay
  readonly forced: boolean
  readonly now: number
  readonly signal: AbortSignal
}

interface PointWrite {
  readonly seriesId: string
  readonly day: TradingDay
  readonly value: number
}

/** The SBV series' only writer. The page shows today only, so a day not captured is lost; a
 *  provider that cannot answer leaves the series as it stands, as the FX writer does. */
export async function refreshPolicyRates(input: PolicyRatesRefresh): Promise<void> {
  const rates = await input.deps.sources.resolve({
    kind: 'policyRates',
    context: { region: VN_MARKET_REGION },
    signal: input.signal,
  })

  if (rates.kind !== 'available') {
    return
  }

  const snapshot = rates.value
  const interbank = INTERBANK_TENORS.flatMap((tenor): PointWrite[] => {
    const value = snapshot.interbankPct[tenor]

    return value === undefined
      ? []
      : [{ seriesId: interbankSeriesId(tenor), day: snapshot.interbankDay, value }]
  })
  const points: readonly PointWrite[] = [
    { seriesId: REFINANCING_SERIES_ID, day: input.asOf, value: snapshot.refinancingPct },
    { seriesId: REDISCOUNT_SERIES_ID, day: input.asOf, value: snapshot.rediscountPct },
    ...interbank,
  ]

  for (const point of points) {
    await input.deps.marketDataStore.upsertSeriesPoint({
      ...point,
      replace: input.forced,
      now: input.now,
      signal: input.signal,
    })
  }
}
