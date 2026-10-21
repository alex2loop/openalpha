import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type {
  SuggestionPortfolioContext,
  SuggestionRunOptions,
} from '@/trading/features/suggestion/pipeline/types'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { LevelResult, TradeLevels } from '@/trading/kernel/factor'
import type { MarketResolution } from '@/trading/markets/types'
import { bankedShareOf, isFirstExitTaken } from '@/trading/features/suggestion/exit-plan/first-exit'
import { heldPositionOf } from '@/trading/features/suggestion/pipeline/concentration'
import { armsExit, planStopOf, planTakeProfitOf } from '@/trading/features/suggestion/types'

interface RatchetedLevels {
  readonly levels: TradeLevels
  readonly caveats: readonly Caveat[]
  /** The prior stop, where the fresh one sits above it: no order resting at an exchange follows. */
  readonly raisedStopFrom?: number
}

function standingExitOf(plan: StoredSuggestion | null): Pick<HeldStop, 'standingExit'> {
  const stop = plan === null ? undefined : planStopOf(plan)
  const takeProfit = plan === null ? undefined : planTakeProfitOf(plan)

  return stop === undefined || takeProfit === undefined
    ? {}
    : { standingExit: { stop, takeProfit } }
}

/** The higher of the fresh stop and the one the standing plan named, only upward and only below the
 *  entry: a prior stop at or above the entry would frame the trade as already stopped, which the
 *  standing-plan check reports on its own row. A review level is never ratcheted, since nothing is
 *  armed under it. The target stays where the fresh read put it. */
export function ratchetStop(levels: TradeLevels, priorStop: number | undefined): RatchetedLevels {
  const { entry, stop, target } = levels

  if (!armsExit(levels) || priorStop === undefined || priorStop >= entry) {
    return { levels, caveats: [] }
  }

  if (priorStop <= stop) {
    return { levels, caveats: [], ...(priorStop < stop ? { raisedStopFrom: priorStop } : {}) }
  }

  return {
    levels: { ...levels, stop: priorStop, riskReward: (target - entry) / (entry - priorStop) },
    caveats: [{ code: 'suggestion.stop-ratcheted' }],
  }
}

interface KeptTakeProfit {
  readonly standingTakeProfit?: number
  readonly caveats: readonly Caveat[]
}

/** A held name keeps the take-profit its standing plan set until the first tranche sells: re-priced
 *  off each day's price, a rising name carries it out of reach. Released where the plan banks
 *  nothing, once the tranche is sold, or once the stop sits above it. */
export function keepTakeProfit(
  levels: TradeLevels,
  prior: StoredSuggestion | null,
  held: { readonly position: HeldPosition | undefined; readonly trails: boolean }
): KeptTakeProfit {
  if (prior === null || held.position === undefined) {
    return { caveats: [] }
  }

  const takeProfit = planTakeProfitOf(prior)
  const unsold =
    armsExit(prior) &&
    bankedShareOf(prior, held.trails) < 1 &&
    !isFirstExitTaken(held.position, prior, held.trails)

  if (!unsold || takeProfit === undefined || takeProfit <= levels.stop) {
    return { caveats: [] }
  }

  return {
    standingTakeProfit: takeProfit,
    caveats: takeProfit === levels.takeProfit ? [] : [{ code: 'suggestion.take-profit-held' }],
  }
}

interface HeldStopInput {
  readonly at: {
    readonly direction: 'buy' | 'reduce'
    readonly context: SuggestionPortfolioContext
  }
  readonly result: LevelResult
}

interface HeldStop {
  readonly result: LevelResult
  readonly raisedStopFrom?: number
  readonly standingExit?: StoredSuggestion['standingExit']
  readonly standingTakeProfit?: number
}

/** A held name keeps the higher of the fresh stop and the one its standing plan named, and that
 *  plan's take-profit. Only the buy framing, only when held: a fresh entry on a name not held takes
 *  its own levels. A reduce is framed on the other side, and a run that priced no levels has none,
 *  so both carry the standing plan's exits instead: they are what the position still runs on. The
 *  target stays where the fresh read put it, so the ratio reported is what the raised stop pays. */
export async function ratchetHeldStop(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  input: HeldStopInput
): Promise<HeldStop> {
  const { at, result } = input
  const held = heldPositionOf(at.context, resolution.instrument)

  if (held === undefined) {
    return { result }
  }

  const prior = await options.deps.store.findLatestExitPlan({
    market: resolution.instrument.market,
    ticker: resolution.instrument.ticker,
    ...(held.openedOn === undefined ? {} : { heldSince: held.openedOn }),
    signal: options.request.signal,
  })

  if (result.kind !== 'available' || at.direction === 'reduce') {
    return { result, ...standingExitOf(prior) }
  }

  const ratcheted = ratchetStop(result.levels, prior === null ? undefined : planStopOf(prior))
  const kept = keepTakeProfit(ratcheted.levels, prior, {
    position: held,
    trails: resolution.market.trail !== undefined,
  })

  return {
    result: {
      ...result,
      levels: ratcheted.levels,
      caveats: [...result.caveats, ...ratcheted.caveats, ...kept.caveats],
    },
    ...(ratcheted.raisedStopFrom === undefined ? {} : { raisedStopFrom: ratcheted.raisedStopFrom }),
    ...(kept.standingTakeProfit === undefined
      ? {}
      : { standingTakeProfit: kept.standingTakeProfit }),
  }
}
