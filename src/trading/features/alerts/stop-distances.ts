import type { ExitWatchDeps } from '@/trading/features/alerts/exits'
import type { StopDistanceOptions } from '@/trading/features/alerts/types'
import type { Holding } from '@/trading/features/portfolio/types'
import type { StopDistance } from '@/trading/kernel/operator/alert'
import { findHoldingPlan, resolveMark } from '@/trading/features/alerts/exits'
import { planStopOf, planTakeProfitOf } from '@/trading/features/suggestion/types'
import { buildInstrumentKey, ETF_KIND } from '@/trading/kernel/instrument'

/** One pass over the book: each holding's stop from its latest exit plan, and how far the current
 *  mark sits from it. A caller that has already valued the book passes its own marks, which both
 *  spares the quote and pins the distance to the price printed beside it; one that has none leaves
 *  them out and the market is asked. */
export async function stopDistances(
  deps: ExitWatchDeps,
  options: StopDistanceOptions
): Promise<readonly StopDistance[]> {
  const holdings = await deps.tradeableHoldingsAt(options)
  const kinds = await deps.instrumentKinds(options)
  const distances: StopDistance[] = []

  for (const holding of holdings) {
    const plan = await findHoldingPlan(deps.store, holding, options.signal)
    const stop = plan === null ? undefined : planStopOf(plan)
    const review = kinds.get(buildInstrumentKey(holding.instrument)) === ETF_KIND

    if (plan === null || stop === undefined) {
      distances.push({ instrument: holding.instrument, plan: 'none', review })
      continue
    }

    const takeProfit = planTakeProfitOf(plan)
    const mark = await resolveMark(deps, holding, options)
    const distance = toStopDistance(holding, { stop, mark, review })

    distances.push(takeProfit === undefined ? distance : { ...distance, takeProfit })
  }

  return distances
}

/** The plan plus the mark it is measured against. A missing mark reports the plan and nothing
 *  else: a distance from an unknown price would read as a measured one. */
function toStopDistance(
  holding: Holding,
  level: { readonly stop: number; readonly mark: number | undefined; readonly review: boolean }
): StopDistance {
  const { stop, mark, review } = level

  if (mark === undefined || mark <= 0) {
    return { instrument: holding.instrument, plan: 'distance', stop, review }
  }

  return {
    instrument: holding.instrument,
    plan: 'distance',
    stop,
    distanceToStopPct: (mark - stop) / mark,
    price: mark,
    review,
  }
}
