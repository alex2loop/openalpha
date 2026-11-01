import type { SizingIntent } from '@/trading/features/suggestion/debate/types'
import type { Caveat, CaveatCode, HoldReasonCode } from '@/trading/kernel/caveat'
import type { BoardLotPolicy } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { MarketManifest } from '@/trading/markets/types'
import { floorToLot } from '@/trading/kernel/instrument'

/** A stop closer than this makes the risk-budget term explode — `risk / distance` with a tiny
 *  distance sizes a position larger than the account. A chosen value; no backtest justifies 0.0025
 *  over a neighbouring threshold. Named `_FRACTION`, not `_PCT`: applied directly as a multiplier
 *  (0.0025 means 0.25%), never scaled by 100 first. */
const MINIMUM_STOP_DISTANCE_FRACTION = 0.0025

/** A suggestion the operator cannot fill near the quoted entry is not a suggestion. One order is
 *  capped at this share of what the name trades on an ordinary session: past a twentieth, impact
 *  studies show the order moving the price it is measured against. Named `_FRACTION`, not `_PCT`:
 *  applied directly as a multiplier (0.05 means 5%), never scaled by 100 first. */
const MAXIMUM_TURNOVER_PARTICIPATION_FRACTION = 0.05

/** What the trader asked for, as a share of policy size. Chosen values, like the conviction scale:
 *  a probe is a quarter, a partial is half. `none` never reaches sizing — the debate declines on
 *  it. */
const SIZING_INTENT_SCALE: Readonly<Record<SizingIntent, number>> = Object.freeze({
  none: 0,
  starter: 0.25,
  partial: 0.5,
  'full-policy-size': 1,
})

/** Which buy ceiling decided the size: the operator's next move differs by answer — widen the stop,
 *  raise a cap, diversify, fund the account, or accept a smaller order. Ordered from the operator's
 *  own budget outward to the market's own constraint, which is the order ties resolve in. */
const SIZING_LIMITS = Object.freeze([
  'risk',
  'open-risk',
  'position-cap',
  'sector',
  'etf',
  'segment',
  'cash',
  'liquidity',
] as const)
type SizingLimit = (typeof SIZING_LIMITS)[number]
type SizingCeilings = Readonly<Record<SizingLimit, number>>

/** A code per ceiling rather than one carrying the ceiling's name: each names a different thing to
 *  go fix, and reporting them all as an exhausted cap sent the operator to raise a limit that was
 *  not the one binding. */
const ZERO_SIZE_REASONS = {
  risk: 'risk-budget-too-small',
  'open-risk': 'open-risk-exhausted',
  'position-cap': 'cap-exhausted',
  sector: 'sector-cap-exhausted',
  etf: 'etf-cap-exhausted',
  segment: 'segment-cap-exhausted',
  cash: 'cash-exhausted',
  liquidity: 'liquidity-too-thin',
} as const satisfies Record<SizingLimit, HoldReasonCode>

/** A code per ceiling rather than one with a `{limit}` param: a stored suggestion is re-rendered in
 *  whatever locale reads it later. */
const SIZE_LIMIT_CAVEATS = {
  risk: 'suggestion.size-limited-by-risk',
  'open-risk': 'suggestion.size-limited-by-open-risk',
  'position-cap': 'suggestion.size-limited-by-position-cap',
  sector: 'suggestion.size-limited-by-sector',
  etf: 'suggestion.size-limited-by-etf',
  segment: 'suggestion.size-limited-by-segment',
  cash: 'suggestion.size-limited-by-cash',
  liquidity: 'suggestion.size-limited-by-liquidity',
} as const satisfies Record<SizingLimit, CaveatCode>

/** Why a call stands without a size: the evidence decided the action, and what is missing is a
 *  number to divide by, not a reason to hold. */
type UnsizedReason = 'zero-nav' | 'fx-rate-unavailable' | 'segment-uncapped'

type SizedMarket = Pick<MarketManifest, 'currency' | 'segment'>

export type SizingResult =
  | {
      readonly kind: 'available'
      readonly units: number
      readonly sizePctNav: number
      /** What the ceilings alone allowed. Absent when conviction and intent scaled nothing away —
       *  the same number twice reads as a discrepancy. */
      readonly policyUnits?: number
      /** Absent on a reduce, whose magnitude comes from the portfolio's over-concentration rather
       *  than from a ceiling. */
      readonly limitedBy?: SizingLimit
      /** The regime scale, present only when it was the tightest attenuation and below one: the
       *  size line then says the tape shrank the order, not the conviction. */
      readonly scaledByRegime?: number
    }
  | { readonly kind: 'unsized'; readonly reason: UnsizedReason }
  | { readonly kind: 'unavailable'; readonly reasonCode: HoldReasonCode }

interface BuySizingInput {
  readonly navBase: number
  readonly entryBase: number
  /** Entry to the entry-relative stop, in base currency: what one unit stands to lose before any
   *  trail moved the stop. */
  readonly riskDistanceBase: number
  /** Cash a buy may actually spend: the book's available cash less the operator's reserve, capped
   *  by what the routed market can reach. The reserve comes off the whole book at the call site,
   *  because it is one obligation — subtracting it per market would charge it once per segment. */
  readonly spendableCashBase: number
  /** What a market order's cash draw exceeds its notional by (fee and price drift), the headroom the
   *  order caps then demand: cash sized to the notional alone would be refused at the order. */
  readonly cashDrawMultiple: number
  /** Room left under the operator's whole-book open-risk ceiling, as a fraction of NAV. Positive
   *  infinity where the book could not be read. */
  readonly openRiskHeadroomPctNav: number
  /** Whether this instrument's stop is acted on. False leaves the two risk-budget ceilings unbound;
   *  every other ceiling applies unchanged. */
  readonly armsExit: boolean
  readonly maximumPositionPctNav: number
  /** Room left under the operator's sector cap, as a fraction of NAV. Positive infinity where the
   *  market files the name under no sector: an unknown sector must not bind, and the remaining
   *  ceilings still do. */
  readonly sectorHeadroomPctNav: number
  /** Room left under the segment's ETF ceiling, as a fraction of NAV. Positive infinity for a name
   *  that is not an ETF and for a segment that declares no ceiling. */
  readonly etfHeadroomPctNav: number
  /** Room left under the operator's segment ceiling, as a fraction of NAV. Every name files under a
   *  segment, so this binds whenever the per-name and sector ceilings have not already. */
  readonly segmentHeadroomPctNav: number
  readonly smallestTick: number
  readonly boardLot: BoardLotPolicy
  /** The multiplier on policy size the conviction band earns, from `resolveSizingScale`. */
  readonly convictionScale: number
  readonly sizingIntent: SizingIntent
  readonly regimeScale: number
  readonly profile: UserProfile
  /** Median session turnover in base currency; absent when the market served no usable bars. */
  readonly medianTurnoverBase?: number
}

interface ReduceSizingInput {
  readonly navBase: number
  readonly entryBase: number
  readonly heldUnits: number
  readonly settledUnits: number
  /** The share of the holding the direction decided to sell, in (0, 1]. */
  readonly saleFraction: number
  readonly boardLot: BoardLotPolicy
}

/** This produces one new position's size from entry/stop distance; `portfolio/rebalance.ts`
 *  redistributes a whole book toward target weights. Neither calls the other. */
export function sizeBuy(input: BuySizingInput): SizingResult {
  const { navBase, entryBase, boardLot } = input
  const distance = input.riskDistanceBase

  // Separated from the input guards below: an unrecorded ledger is the operator's to fix, and
  // reporting it as missing data sends them looking at the market instead of at their own book.
  if (navBase <= 0) {
    return { kind: 'unsized', reason: 'zero-nav' }
  }

  if (
    entryBase <= 0 ||
    distance < Math.max(entryBase * MINIMUM_STOP_DISTANCE_FRACTION, input.smallestTick)
  ) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  const ceilings = buildCeilings(input, distance)
  // Taken over the values rather than read off `bindingLimit`: a NaN ceiling loses every comparison
  // and would be skipped, where the minimum propagates it and the guard below rejects the size.
  const headroom = Math.min(...SIZING_LIMITS.map((limit) => ceilings[limit]))
  // The tightest of the three, never their product: each answers "what share of policy size", and
  // multiplying independently chosen attenuations lands on a number none of them asserts — low
  // conviction and a probe intent compounded to under a lot, which is not what either meant.
  const regime = Math.min(input.regimeScale, input.profile.regimeScale, 1)
  const intent = SIZING_INTENT_SCALE[input.sizingIntent]
  const attenuation = Math.min(input.convictionScale, intent, regime)
  const policyUnits = floorToLot(headroom, boardLot.size)
  const units = floorToLot(headroom * attenuation, boardLot.size)

  // `Number.isFinite` alongside the zero check: a corrupt lot size or an upstream NaN in any
  // ceiling must never present as available — `NaN <= 0` and `Infinity <= 0` are both false.
  if (!Number.isFinite(units) || units <= 0) {
    return { kind: 'unavailable', reasonCode: zeroSizeReason(headroom, boardLot.size, ceilings) }
  }

  return {
    kind: 'available',
    units,
    sizePctNav: (units * entryBase) / navBase,
    limitedBy: bindingLimit(ceilings),
    ...(policyUnits > units ? { policyUnits } : {}),
    ...(regime < 1 && regime <= Math.min(input.convictionScale, intent)
      ? { scaledByRegime: regime }
      : {}),
  }
}

/** Independent ceilings, each answering a different question. The minimum wins because any one of
 *  them being binding is a real constraint. The regime is not one of them: it attenuates the final
 *  size in `sizeBuy`, where it binds whether or not cash happens to be the tightest ceiling. */
function buildCeilings(input: BuySizingInput, distance: number): SizingCeilings {
  const { navBase, entryBase } = input
  // A level nothing acts on caps no loss, so neither ceiling priced off it binds — and because such
  // an instrument is the calm one, dividing by its small distance would have sized it largest of
  // all. Its weight is the position and segment ceilings' decision instead.
  const risk = input.armsExit
    ? (input.profile.riskPerTradePctNav * navBase) / distance
    : Number.POSITIVE_INFINITY
  const openRisk = input.armsExit
    ? (input.openRiskHeadroomPctNav * navBase) / distance
    : Number.POSITIVE_INFINITY

  return {
    risk,
    'open-risk': openRisk,
    'position-cap': (input.maximumPositionPctNav * navBase) / entryBase,
    sector: (input.sectorHeadroomPctNav * navBase) / entryBase,
    etf: (input.etfHeadroomPctNav * navBase) / entryBase,
    segment: (input.segmentHeadroomPctNav * navBase) / entryBase,
    cash: input.spendableCashBase / (entryBase * input.cashDrawMultiple),
    // Unmeasured turnover is not illiquid: an absent read must pass, never cap. A measured zero is
    // a name that traded nothing, so it has no room.
    liquidity:
      input.medianTurnoverBase === undefined
        ? Number.POSITIVE_INFINITY
        : (input.medianTurnoverBase * MAXIMUM_TURNOVER_PARTICIPATION_FRACTION) / entryBase,
  }
}

/** A ceiling that cannot fund one lot is a real constraint on the account, and which one it is
 *  decides what the operator can do about it. A ceiling that could have funded a lot but was scaled
 *  under one by conviction and intent is not a constraint at all, and says so. */
function zeroSizeReason(
  headroom: number,
  lotSize: number,
  ceilings: SizingCeilings
): HoldReasonCode {
  return Number.isFinite(headroom) && headroom >= lotSize
    ? 'size-below-board-lot'
    : ZERO_SIZE_REASONS[bindingLimit(ceilings)]
}

/** On a tie the earlier arm wins: equal ceilings are all binding, and naming one beats naming
 *  none. */
function bindingLimit(ceilings: SizingCeilings): SizingLimit {
  return SIZING_LIMITS.reduce((tightest, limit) =>
    ceilings[limit] < ceilings[tightest] ? limit : tightest
  )
}

/** A reduce never invents a magnitude: `saleFraction` is what the direction already decided to sell.
 *  It is taken of the units held, never of a NAV share priced back into units, so a whole exit sells
 *  every lot. Clamped to settled quantity, then floored to the lot — that order means a reduce can
 *  never round or clamp its way past the position, an unsettled sale is impossible, and the order
 *  is always one the board fills. */
export function sizeReduce(input: ReduceSizingInput): SizingResult {
  const { navBase, entryBase, boardLot, heldUnits, settledUnits, saleFraction } = input

  if (navBase <= 0) {
    return { kind: 'unsized', reason: 'zero-nav' }
  }

  if (entryBase <= 0 || !(saleFraction > 0)) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  if (settledUnits <= 0) {
    return { kind: 'unavailable', reasonCode: 'position-unsettled' }
  }

  const owed = heldUnits * Math.min(saleFraction, 1)
  const units = floorToLot(Math.min(owed, settledUnits), boardLot.size)

  if (!Number.isFinite(units)) {
    return { kind: 'unavailable', reasonCode: 'insufficient-data' }
  }

  // A lot the sale owes but settlement has not delivered yet is waiting on T+N, not too small.
  if (units <= 0) {
    return {
      kind: 'unavailable',
      reasonCode:
        floorToLot(owed, boardLot.size) > 0 ? 'position-unsettled' : 'sale-below-board-lot',
    }
  }

  return { kind: 'available', units, sizePctNav: (units * entryBase) / navBase }
}

/** What the size, or its absence, tells the reader. Empty when no ceiling scaled anything away. */
export function sizeCaveats(
  sized: Exclude<SizingResult, { readonly kind: 'unavailable' }>,
  market: SizedMarket
): readonly Caveat[] {
  if (sized.kind === 'unsized') {
    return [unsizedCaveat(sized.reason, market)]
  }

  const limit = sized.limitedBy === undefined ? [] : [{ code: SIZE_LIMIT_CAVEATS[sized.limitedBy] }]
  const regime =
    sized.scaledByRegime === undefined
      ? []
      : [
          {
            code: 'suggestion.size-scaled-by-regime',
            detail: { scale: sized.scaledByRegime },
          } as const,
        ]

  return [...limit, ...regime]
}

function unsizedCaveat(reason: UnsizedReason, market: SizedMarket): Caveat {
  switch (reason) {
    case 'zero-nav':
      return { code: 'suggestion.size-unavailable' }
    case 'fx-rate-unavailable':
      return { code: 'suggestion.size-fx-unavailable', detail: { currency: market.currency } }
    case 'segment-uncapped':
      return { code: 'suggestion.size-segment-uncapped', detail: { segment: market.segment } }
    default: {
      const exhaustive: never = reason
      return exhaustive
    }
  }
}
