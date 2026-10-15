import type { Caveat } from '@/trading/kernel/caveat'
import type { LevelPolicy, LevelRequest, LevelResult, TradeLevels } from '@/trading/kernel/factor'
import type { DailyPriceBand, TickSizePolicy, TradingDay } from '@/trading/kernel/instrument'
import type { InstrumentRequest } from '@/trading/kernel/market/market-capability'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { InvestmentHorizon } from '@/trading/kernel/operator/profile'
import type { RestingEntryPrice } from '@/trading/markets/resting-entry'
import type { Market, MarketTrail, TickSizeRequest, TrailBounds } from '@/trading/markets/types'
import { restingEntryOf } from '@/trading/markets/resting-entry'
import { trailingHigh } from '@/trading/markets/timeseries'

export const LEVEL_FORMULA_VERSION = '1.0.0'

/** Enough history for any registered market's ATR window plus its trend lookback. The longest bar
 *  series any reader asks a market for, and so the floor a stored series must keep. */
export const LEVEL_BARS_SESSIONS = 260

/** What a market's stored bars must reach: its own evidence window or the level read, whichever
 *  is longer. Retention and the refresh both take this, so the one cannot sweep what the other
 *  is about to ask for. */
export function longestBarWindow(evidenceSessions: number): number {
  return Math.max(evidenceSessions, LEVEL_BARS_SESSIONS)
}

type TickRounding = 'nearest' | 'down' | 'up'

interface PriceRange {
  readonly support: number
  readonly resistance: number
  readonly last: number
}

// Binary division leaves a price a hair under its own tick multiple; the tolerance keeps a
// directional round from stepping a whole tick away for a value that is already on the grid.
const TICK_STEP_EPSILON = 1e-9
const MAXIMUM_TICK_DECIMALS = 12
const STOP_CAPPED_CAVEAT: Caveat = Object.freeze({ code: 'market.stop-capped' })

interface StopDistances {
  readonly stop: number
  /** The ATRs the trail may not pull a fresh stop inside, held under the ceiling too. */
  readonly floor: number
  readonly capped: boolean
}

interface BuildLevelsInput extends LevelRequest {
  /** The session the entry quote printed in, set by a caller pricing a fresh order at a live quote. */
  readonly entrySession?: TradingDay
  readonly policy: LevelPolicy
  readonly tickSize: TickSizePolicy
}

export function buildLevels(request: BuildLevelsInput): LevelResult {
  const { candles, policy, tickSize } = request

  // True range needs a previous close, so the first usable window is one candle longer than the
  // ATR window itself.
  if (candles.length < policy.atrSessions + 1) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  // Before the ATR is read, not after: a close-only series still averages to a positive number, and
  // that number is roughly half a real ATR. It would pass every guard below and quietly halve the
  // stop distance the policy asked for.
  if (!hasIntradayRange(candles, policy.atrSessions)) {
    return {
      kind: 'unavailable',
      reasonCode: 'insufficient-data',
      caveats: [{ code: 'market-data.close-only-series' }],
    }
  }

  const atr = averageTrueRange(candles, policy.atrSessions)
  const last = candles[candles.length - 1]

  // `!(x > 0)` instead of `x <= 0`: NaN and Infinity (a malformed candle or quote) fail this form
  // but pass the naive comparison, and a level built from them would present garbage as available.
  if (last === undefined || !(atr > 0) || !Number.isFinite(atr)) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  const resting = restingEntryOf({
    ...request,
    rule: policy.restingEntry,
    entrySession: request.entrySession,
    atr,
  })
  const entry = resting?.entry ?? request.entry ?? last.close

  if (!(entry > 0 && Number.isFinite(entry))) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  if (
    request.dailyBand !== undefined &&
    !isWithinDailyBand(roundToTick(entry, tickSize, 'nearest'), request.dailyBand)
  ) {
    return { kind: 'unavailable', reasonCode: 'market-not-tradeable' }
  }

  // A reduce is the mirror image: stop above entry. The distance stays raw — `buildRoundedLevels` owns
  // rounding and places the target for every caller, not just this one.
  const distances = stopDistancesOf(request, { atr, entry })
  // The trail only ever raises a buy's stop, so the floor is re-applied over it: without the clamp
  // a name sitting on its Chandelier line keeps a stop the floor was meant to push away.
  const stop =
    request.direction === 'buy'
      ? Math.min(
          trailedStop(candles, { entry, entryStop: entry - distances.stop, policy }),
          entry - distances.floor
        )
      : entry + distances.stop
  const result = buildRoundedLevels({
    entry,
    atr,
    tickSize,
    stop: withinCeiling(stop, request, entry),
    riskDistance: distances.stop,
    direction: request.direction,
    targetRiskMultiplier: policy.targetRiskMultiplier[request.horizon],
    ...takeProfitMultiplierOf(policy, request.horizon),
    ...(request.dailyBand === undefined ? {} : { dailyBand: request.dailyBand }),
  })

  const priced = resting === undefined ? result : withResting(result, resting)

  return distances.capped ? withCaveat(priced, STOP_CAPPED_CAVEAT) : priced
}

function takeProfitMultiplierOf(
  policy: LevelPolicy,
  horizon: InvestmentHorizon
): { readonly takeProfitRiskMultiplier?: number } {
  const multiplier = policy.takeProfitRiskMultiplier?.[horizon]

  return multiplier === undefined ? {} : { takeProfitRiskMultiplier: multiplier }
}

/** The operator's ceiling wins over both the ATR distance and the trail floor: it is the most they
 *  agreed to lose, and the target follows the risk that is actually left. */
function stopDistancesOf(
  request: BuildLevelsInput,
  at: { readonly atr: number; readonly entry: number }
): StopDistances {
  const { policy } = request
  const floor = at.atr * (policy.trail?.minimumStopMultiplier ?? 0)
  const designed = Math.max(at.atr * policy.stopVolatilityMultiplier[request.horizon], floor)
  const ceiling = at.entry * (policy.maximumStopLoss ?? Number.POSITIVE_INFINITY)

  return {
    stop: Math.min(designed, ceiling),
    floor: Math.min(floor, ceiling),
    capped: designed > ceiling,
  }
}

/** Rounding moves a stop away from entry, which would carry it a tick past the operator's ceiling;
 *  a stop near the ceiling is held on the grid line just inside it instead. */
function withinCeiling(stop: number, request: BuildLevelsInput, entry: number): number {
  const fraction = request.policy.maximumStopLoss

  if (fraction === undefined) {
    return stop
  }

  const priced = roundToTick(entry, request.tickSize, 'nearest')

  return request.direction === 'buy'
    ? Math.max(stop, roundToTick(priced * (1 - fraction), request.tickSize, 'up'))
    : Math.min(stop, roundToTick(priced * (1 + fraction), request.tickSize, 'down'))
}

function withCaveat(result: LevelResult, caveat: Caveat): LevelResult {
  return result.kind === 'available' ? { ...result, caveats: [...result.caveats, caveat] } : result
}

function withResting(result: LevelResult, resting: RestingEntryPrice): LevelResult {
  if (result.kind !== 'available') {
    return result
  }

  const { run, runSessions, validSessions } = resting

  return { ...result, levels: { ...result.levels, resting: { run, runSessions, validSessions } } }
}

/** The Chandelier level for a market that declares a trail: the highest close of the window less
 *  the policy's ATR multiple, and never inside `minimumStopMultiplier` ATRs of the last close - the
 *  same floor a fresh entry's stop keeps, so the exit tick cannot pull a held stop inside it. A
 *  level at or above the close is returned as read: it is a pullback deeper than the trail allows,
 *  which every caller skips. Absent where the policy has no trail or the series is too short. */
function trailingStopOf(candles: readonly Candle[], policy: LevelPolicy): number | undefined {
  const last = candles.at(-1)

  if (policy.trail === undefined || last === undefined || candles.length < policy.atrSessions + 1) {
    return undefined
  }

  const high = trailingHigh(
    candles.map((candle) => candle.close),
    policy.trail.sessions
  )
  const atr = averageTrueRange(candles, policy.atrSessions)

  if (high === undefined || !(atr > 0)) {
    return undefined
  }

  const chandelier = high - atr * policy.trail.volatilityMultiplier
  const floor = atr * (policy.trail.minimumStopMultiplier ?? 0)

  return chandelier < last.close ? Math.min(chandelier, last.close - floor) : chandelier
}

interface TrailedStopInput {
  readonly entry: number
  readonly entryStop: number
  readonly policy: LevelPolicy
}

/** The market's trail, where its level policy declares one. It reads the longer of the ATR window
 *  and the high-close window, so a caller fetching that many sessions gets the level `stopFor`
 *  would give on the full series. The level is rounded away from the price onto the instrument's
 *  grid, as a fresh stop is. */
export function trailOf(policy: LevelPolicy): { readonly trail?: MarketTrail } {
  const { trail } = policy

  if (trail === undefined) {
    return {}
  }

  return {
    trail: {
      sessions: Math.max(policy.atrSessions + 1, trail.sessions),
      stopFor: (candles, bounds) => {
        const stop = trailingStopOf(candles, policy)

        return stop === undefined ? undefined : roundToTick(stop, bounds.tickSize, 'down')
      },
    },
  }
}

/** The price grid one instrument trades on: the market's own answer where its grid depends on the
 *  listing, the manifest's table otherwise. */
async function resolveTickSize(
  market: Pick<Market, 'manifest' | 'tickSizeOf'>,
  request: TickSizeRequest
): Promise<TickSizePolicy> {
  return (await market.tickSizeOf?.(request)) ?? market.manifest.tickSize
}

/** What a trailed stop is held to: the instrument's own grid. The exit tick that raises a stop and
 *  the scorer that replays it read this one answer, so the record grades the stop the operator is
 *  told to run. */
export async function resolveTrailBounds(
  market: Pick<Market, 'manifest' | 'tickSizeOf'>,
  request: InstrumentRequest
): Promise<TrailBounds> {
  const tickSize = await resolveTickSize(market, {
    instrument: request.instrument,
    signal: request.signal,
  })

  return { tickSize }
}

/** The higher of the entry-relative stop and the trail, so a name that has run keeps what it
 *  gained. A trail that has already climbed past the entry is a name in a pullback deeper than the
 *  trail allows; the entry stop stands, and the reduce-side caller never trails. */
function trailedStop(candles: readonly Candle[], input: TrailedStopInput): number {
  const { policy, entry, entryStop } = input
  const trailed = trailingStopOf(candles, policy)

  if (trailed === undefined) {
    return entryStop
  }

  return trailed < entry ? Math.max(entryStop, trailed) : entryStop
}

/** Where what is left to win stops paying the market's minimum multiple of what is left to lose:
 *  the price at which `reward / risk` is exactly the floor, reached from above by a buy and from
 *  below by a reduce. Never past the take-profit: a buy filled beyond it has already spent the first
 *  exit its plan banks at, which happens whenever a trail pulled the stop inside its designed
 *  distance. The floor belongs to the market, so a plan that names this level and a read that
 *  voids a standing one derive it here rather than each fixing a multiple of their own. */
export function voidPrice(
  levels: Pick<TradeLevels, 'stop' | 'target' | 'takeProfit'>,
  minimumRiskReward: number
): number {
  const { stop, target, takeProfit } = levels
  const bound = (target + minimumRiskReward * stop) / (1 + minimumRiskReward)

  return stop < target ? Math.min(bound, takeProfit) : Math.max(bound, takeProfit)
}

/** Shared support/resistance range over positive closes. */
export function buildPriceRange(closes: readonly number[]): PriceRange | undefined {
  const usable = closes.filter((close) => Number.isFinite(close) && close > 0)
  const last = usable[usable.length - 1]

  if (last === undefined) {
    return undefined
  }

  return { support: Math.min(...usable), resistance: Math.max(...usable), last }
}

interface RoundedLevelsInput {
  readonly entry: number
  readonly stop: number
  readonly atr: number
  readonly tickSize: TickSizePolicy
  readonly direction: 'buy' | 'reduce'
  readonly targetRiskMultiplier: number
  readonly takeProfitRiskMultiplier?: number
  /** Absent for a caller whose stop is entry-relative: the rounded distance is then the risk. */
  readonly riskDistance?: number
  readonly dailyBand?: DailyPriceBand
}

/** The one rounding rule and target placement, shared by candle-driven and board-driven callers.
 *  The stop is rounded away from entry; the target is a multiple of the initial risk, so a trail
 *  or a ratchet that tightens the stop raises the ratio rather than pulling the target in. */
export function buildRoundedLevels(input: RoundedLevelsInput): LevelResult {
  const { atr, tickSize, direction, targetRiskMultiplier } = input
  const [stopRounding, targetRounding]: readonly [TickRounding, TickRounding] =
    direction === 'buy' ? ['down', 'up'] : ['up', 'down']
  const entry = roundToTick(input.entry, tickSize, 'nearest')
  // Both round away from entry: a wider stop and a farther target each hold the ratio at or above
  // the multiplier.
  const stop = roundToTick(input.stop, tickSize, stopRounding)
  const risk = Math.abs(entry - stop)
  // The target is a multiple of the *initial* risk - the entry-relative distance sizing reads - and
  // never of a stop a trail moved closer. Measured from the trailed stop, a name sitting on its
  // Chandelier line got a target one ATR away and a plan spent on the next session's noise. That
  // distance is taken to where its own stop would sit on the grid, so sizing never budgets less
  // loss than the rounded stop carries.
  const basis =
    input.riskDistance === undefined
      ? risk
      : designedRisk(input, { entry, stopRounding, distance: input.riskDistance })
  const targetDistance = targetRiskMultiplier * basis
  const target = roundToTick(
    direction === 'buy' ? entry + targetDistance : entry - targetDistance,
    tickSize,
    targetRounding
  )
  const reward = Math.abs(target - entry)

  // `!(x > 0)` so NaN/Infinity from a malformed input reads as unavailable, never as a level.
  if (!(stop > 0 && target > 0 && risk > 0 && reward > 0 && Number.isFinite(risk + reward))) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  return {
    kind: 'available',
    levels: {
      entry,
      stop,
      target,
      takeProfit: takeProfitFor(input, { entry, target, basis }),
      riskReward: reward / risk,
      atr,
      riskDistance: basis,
    },
    caveats: [],
    ...(input.dailyBand === undefined ? {} : { dailyBand: input.dailyBand }),
  }
}

/** Placed from the unrounded entry, as the stop itself is, and measured from the rounded one. */
function designedRisk(
  input: Pick<RoundedLevelsInput, 'direction' | 'tickSize' | 'entry'>,
  at: { readonly entry: number; readonly stopRounding: TickRounding; readonly distance: number }
): number {
  const { distance } = at
  const designed = input.direction === 'buy' ? input.entry - distance : input.entry + distance

  return Math.abs(at.entry - roundToTick(designed, input.tickSize, at.stopRounding))
}

/** Only a buy banks a tranche early, and only short of its target: a multiple at or past it names
 *  the target again. Rounded away from entry, as the target is. */
function takeProfitFor(
  input: RoundedLevelsInput,
  levels: { readonly entry: number; readonly target: number; readonly basis: number }
): number {
  const multiplier = input.takeProfitRiskMultiplier

  if (input.direction !== 'buy' || multiplier === undefined) {
    return levels.target
  }

  const takeProfit = roundToTick(levels.entry + multiplier * levels.basis, input.tickSize, 'up')

  return Math.min(takeProfit, levels.target)
}

/** Whether the window an ATR over `sessions` reads carries any session range. A close-only feed
 *  parses into candles whose true range collapses to the close-to-close move, roughly half a real
 *  ATR, so the window itself is read rather than the whole series. One ranged candle is enough: a
 *  session locked at its band limit prints no range either, and its true range is still right. */
export function hasIntradayRange(candles: readonly Candle[], sessions: number): boolean {
  return candles.slice(-(sessions + 1)).some((candle) => candle.high > candle.low)
}

/** Standard `max(high - low, |high - prevClose|, |low - prevClose|)` averaged over `sessions`. */
export function averageTrueRange(candles: readonly Candle[], sessions: number): number {
  const window = candles.slice(-(sessions + 1))
  let sum = 0

  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1]
    const current = window[index]

    if (previous === undefined || current === undefined) {
      return 0
    }

    sum += Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    )
  }

  return window.length > 1 ? sum / (window.length - 1) : 0
}

export function roundToTick(price: number, policy: TickSizePolicy, rounding: TickRounding): number {
  const tick = tickSizeFor(price, policy)

  if (!(tick > 0)) {
    return price
  }

  const steps = price / tick
  const rounded = roundSteps(steps, rounding)

  // Multiplying back reintroduces binary drift, so the result is snapped to the tick's own
  // decimal precision instead of being handed on as 49.900000000000006.
  return Number((rounded * tick).toFixed(tickDecimals(tick)))
}

/** Tiered bands are ordered low to high; the open-ended band applies above every stated ceiling. */
export function tickSizeFor(price: number, policy: TickSizePolicy): number {
  for (const band of policy.bands) {
    if (band.maximumPriceExclusive === undefined || price < band.maximumPriceExclusive) {
      return band.tickSize
    }
  }

  return policy.bands[policy.bands.length - 1]?.tickSize ?? 0
}

function isWithinDailyBand(price: number, band: DailyPriceBand): boolean {
  return price >= band.floor && price <= band.ceiling
}

function roundSteps(steps: number, rounding: TickRounding): number {
  if (rounding === 'nearest') {
    return Math.round(steps)
  }

  return rounding === 'down'
    ? Math.floor(steps + TICK_STEP_EPSILON)
    : Math.ceil(steps - TICK_STEP_EPSILON)
}

function tickDecimals(tick: number): number {
  const [mantissa, exponent] = tick.toExponential().split('e')
  const fractionDigits = (mantissa?.split('.')[1] ?? '').length

  return Math.min(MAXIMUM_TICK_DECIMALS, Math.max(0, fractionDigits - Number(exponent ?? '0')))
}
