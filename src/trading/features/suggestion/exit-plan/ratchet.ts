import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type {
  SuggestionPortfolioContext,
  SuggestionRunOptions,
} from '@/trading/features/suggestion/pipeline/types'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { LevelResult, TradeLevels } from '@/trading/kernel/factor'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { Market, MarketResolution } from '@/trading/markets/types'
import { bankedShareOf, isFirstExitTaken } from '@/trading/features/suggestion/exit-plan/first-exit'
import { heldPositionOf } from '@/trading/features/suggestion/pipeline/concentration'
import { type ExRightGap, planBasisFactorOf } from '@/trading/features/suggestion/pipeline/ex-right'
import { armsExit, planStopOf, planTakeProfitOf } from '@/trading/features/suggestion/types'
import { resolveTrailBounds, roundToTick } from '@/trading/markets/levels'

interface RatchetedLevels {
  readonly levels: TradeLevels
  readonly caveats: readonly Caveat[]
  /** The prior stop, where the fresh one sits above it: no order resting at an exchange follows. */
  readonly raisedStopFrom?: number
}

function standingExitOf(standing: StandingPlan): Pick<HeldStop, 'standingExit'> {
  const { plan, toBasis } = standing
  const stop = plan === null ? undefined : planStopOf(plan)
  const takeProfit = plan === null ? undefined : planTakeProfitOf(plan)

  return stop === undefined || takeProfit === undefined
    ? {}
    : { standingExit: { stop: toBasis(stop), takeProfit: toBasis(takeProfit) } }
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
  held: {
    readonly position: HeldPosition | undefined
    readonly trails: boolean
    /** Moves the plan's price onto the series' current basis; absent where it already stands there. */
    readonly toBasis?: (price: number) => number
  }
): KeptTakeProfit {
  if (prior === null || held.position === undefined) {
    return { caveats: [] }
  }

  const planned = planTakeProfitOf(prior)
  const takeProfit =
    planned === undefined || held.toBasis === undefined ? planned : held.toBasis(planned)
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
    readonly asOf: TradingDay
    readonly direction: 'buy' | 'reduce'
    readonly context: SuggestionPortfolioContext
  }
  readonly result: LevelResult
  /** An ex-date the stored series has not caught up to: the standing plan moves with the price. */
  readonly gap?: ExRightGap
}

/** The standing plan as this run carries it, and how its prices reach the series' basis. */
interface StandingPlan {
  readonly plan: StoredSuggestion | null
  readonly toBasis: (price: number) => number
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

  const standing = await standingPlanOf(options, resolution, {
    held,
    asOf: at.asOf,
    gap: input.gap,
  })
  const { plan: prior, toBasis } = standing

  if (result.kind !== 'available' || at.direction === 'reduce') {
    return { result, ...standingExitOf(standing) }
  }

  const priorStop = prior === null ? undefined : planStopOf(prior)
  const ratcheted = ratchetStop(
    result.levels,
    priorStop === undefined ? undefined : toBasis(priorStop)
  )
  const kept = keepTakeProfit(ratcheted.levels, prior, {
    position: held,
    trails: resolution.market.trail !== undefined,
    toBasis,
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

/** The plan the holding stands on, moved onto the series' current basis where an ex-date passed
 *  since it was priced, onto the instrument's own tick grid. A plan the action leaves unpriceable is
 *  not carried. */
async function standingPlanOf(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  input: {
    readonly held: HeldPosition
    readonly asOf: TradingDay
    readonly gap: ExRightGap | undefined
  }
): Promise<StandingPlan> {
  const { instrument, market } = resolution
  const plan = await options.deps.store.findLatestExitPlan({
    market: instrument.market,
    ticker: instrument.ticker,
    ...(input.held.openedOn === undefined ? {} : { heldSince: input.held.openedOn }),
    signal: options.request.signal,
  })

  return toStandingPlan(plan, {
    market,
    instrument,
    gap: input.gap,
    asOf: input.asOf,
    now: options.request.now,
    signal: options.request.signal,
  })
}

/** Where a stored plan's prices stand against the series' basis: the one answer to an ex-date the
 *  store has not caught up to, for the suggestion run and the recorded plan alike. */
export async function toStandingPlan(
  plan: StoredSuggestion | null,
  input: {
    readonly market: Market
    readonly instrument: InstrumentRef
    readonly gap: ExRightGap | undefined
    readonly asOf: TradingDay
    readonly now: number
    readonly signal: AbortSignal
  }
): Promise<StandingPlan> {
  const factor = plan === null ? 1 : planBasisFactorOf(plan, input.gap)

  if (factor === null) {
    return { plan: null, toBasis: samePrice }
  }

  if (factor === 1) {
    return { plan, toBasis: samePrice }
  }

  const { tickSize } = await resolveTrailBounds(input.market, {
    instrument: input.instrument,
    asOf: input.asOf,
    now: input.now,
    signal: input.signal,
  })

  return { plan, toBasis: (price) => roundToTick(price * factor, tickSize, 'nearest') }
}

// A plan already priced on the series' current basis keeps its prices.
function samePrice(price: number): number {
  return price
}
