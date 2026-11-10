import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { InvestmentHorizon } from '@/trading/kernel/operator/profile'
import type { MarketRegistry } from '@/trading/markets/types'
import { resolveMaturedCutoff } from '@/trading/features/suggestion/pipeline/outcome-window'

interface MaturableCall {
  readonly instrument: InstrumentRef
  readonly at: TradingDay
  readonly horizon: InvestmentHorizon
}

interface MaturityClock {
  readonly markets: MarketRegistry
  readonly now: number
}

/** A call counts once its outcome window has passed: before that a quick stop-out is in the record
 *  while the winners that need the whole window are not, which drags every rate down. */
export function splitByMaturity<T extends MaturableCall>(
  calls: readonly T[],
  clock: MaturityClock
): { readonly mature: readonly T[]; readonly early: readonly T[] } {
  const cutoffs = new Map<string, TradingDay | null>()
  const mature: T[] = []
  const early: T[] = []

  for (const call of calls) {
    const key = `${call.instrument.market}:${call.horizon}`
    let cutoff = cutoffs.get(key)

    if (cutoff === undefined) {
      cutoff = cutoffOf(clock, call)
      cutoffs.set(key, cutoff)
    }

    // An unbuilt market takes no new calls; leaving its old ones out would hide them for good.
    if (cutoff === null || call.at <= cutoff) {
      mature.push(call)
    } else {
      early.push(call)
    }
  }

  return { mature, early }
}

function cutoffOf(clock: MaturityClock, call: MaturableCall): TradingDay | null {
  const market = clock.markets.find(call.instrument.market)

  return market === null ? null : resolveMaturedCutoff(market, call.horizon, clock.now)
}
