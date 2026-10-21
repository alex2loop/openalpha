import type { PositionChange } from '@/trading/features/portfolio/types'
import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type {
  DraftDirection,
  SuggestionPortfolioContext,
} from '@/trading/features/suggestion/pipeline/types'
import type { Suggestion, SuggestionDirection } from '@/trading/features/suggestion/types'
import type { EvidenceReduceReasonCode, HoldReasonCode } from '@/trading/kernel/caveat'
import type { LeanDebateReason } from '@/trading/kernel/config'
import type { FactorComposite, FactorScore } from '@/trading/kernel/factor'
import type {
  InstrumentKind,
  InstrumentRef,
  PortfolioSegment,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { MarketEvent } from '@/trading/kernel/market/market-data'
import type { InvestmentHorizon, UserProfile } from '@/trading/kernel/operator/profile'
import type { Market } from '@/trading/markets/types'
import { isPositionStale } from '@/trading/features/suggestion/exit-plan/staleness'
import { heldPositionOf } from '@/trading/features/suggestion/pipeline/concentration'
import { BUSINESS_FACTOR_IDS } from '@/trading/kernel/factor'
import { ETF_KIND, floorToLot, isSameInstrument } from '@/trading/kernel/instrument'
import { isTradingEnd } from '@/trading/kernel/market/market-event'
import { isSegmentDisabled } from '@/trading/kernel/operator/profile'
import { regimeFor } from '@/trading/markets/macro-risk'

/** The holds decided from the book and the score before any persona runs. The debate can only
 *  lower, so nothing it says changes one of these: depth is spend without a reader, and the reuse
 *  ratchet has nothing to ratchet.
 *
 *  A weakening thesis is deliberately not among them. Its action is equally fixed, but its reader
 *  is a holder deciding whether to exit, and the argument is the product: `CASE_SIDES.reduce`
 *  frames one side as keeping the position and the other as selling down, which is the question
 *  they actually have. */
const FACTOR_HOLD_REASONS: ReadonlySet<HoldReasonCode> = new Set<HoldReasonCode>([
  'factors-bearish',
  'factors-neutral',
  'factors-contested',
])
const BOOK_HOLD_REASONS: ReadonlySet<HoldReasonCode> = new Set<HoldReasonCode>([
  'no-rebalance-needed',
  'evidence-sold',
  'sale-below-board-lot',
  'increase-unfunded',
  'segment-off',
  'segment-target-zero',
  'reference-only',
  ...FACTOR_HOLD_REASONS,
])
/** Below this share of the position, what an evidence cut still owes is float residue. */
const OWED_RESIDUE_FRACTION = 1e-9

/** Who settled a hold no debate can change: the scores or the portfolio. */
export function bookHoldOf(
  suggestion: Suggestion
): Extract<LeanDebateReason, 'factors-hold' | 'book-hold'> | undefined {
  if (hasHoldReasonIn(suggestion, FACTOR_HOLD_REASONS)) {
    return 'factors-hold'
  }

  return hasHoldReasonIn(suggestion, BOOK_HOLD_REASONS) ? 'book-hold' : undefined
}

function hasHoldReasonIn(suggestion: Suggestion, reasons: ReadonlySet<HoldReasonCode>): boolean {
  return (
    suggestion.action === 'hold' && suggestion.holdReasonCodes.some((code) => reasons.has(code))
  )
}

/** How much of a held position, as opened, each evidence reason sells. A failed breakout is exited
 *  whole - the Turtle rule its trigger came from; the rest halve, which is the size a re-entry can
 *  rebuild from. Overheating and a ceiling close read the operator's own take-profit tranche,
 *  because that is what they are. */
const REDUCE_SALE_FRACTIONS: Readonly<
  Record<Exclude<EvidenceReduceReasonCode, 'overheated' | 'ceiling-close'>, number>
> = Object.freeze({
  'thesis-weakening': 0.5,
  'structure-broken': 1,
  'regime-risk-off': 0.5,
  stale: 0.5,
})

/** Signals that read a short holding window: a long segment is not read by them. */
const SHORT_HORIZON_SIGNALS: ReadonlySet<EvidenceReduceReasonCode> = new Set([
  'structure-broken',
  'ceiling-close',
])

/** The direction the *draft* carries, and why it holds when it does — not a verdict: gates, debate,
 *  and stages may still force hold. Decided once, from the book, the composite factor score, the
 *  corporate calendar, and the advice's own weight gap, so levels and sizing cannot disagree about it. */
export function draftDirectionFor(input: DirectionInput): DraftDirection {
  const { context, instrument, factors } = input
  const change = planChangeOf(context, instrument)
  const held = heldPositionOf(context, instrument)
  const sale =
    held === undefined
      ? trimOf(change)
      : largerSaleOf(trimOf(change), evidenceSaleFor(input, held), {
          held,
          lotSize: input.market.manifest.boardLot.size,
        })

  if (sale !== undefined) {
    return sale
  }

  // Selling stays open in a segment the operator turned off; only adding to it is closed.
  if (isSegmentOff(context.profile, input.market.manifest.segment)) {
    const traded = context.heldMarkets.has(input.market.manifest.id)

    return { action: 'hold', reasonCode: traded ? 'segment-off' : 'reference-only' }
  }

  // A target of zero steers the segment to nothing: a name not yet held opens no position there.
  if (held === undefined && isTargetZero(context.profile, input.market.manifest.segment)) {
    return { action: 'hold', reasonCode: 'segment-target-zero' }
  }

  // A name about to stop trading has no position to open, whatever the score or the core is owed.
  if (input.upcomingEvents.some(isTradingEnd)) {
    return { action: 'hold', reasonCode: 'market-not-tradeable' }
  }

  // The core is owed its floor whatever the score says; the debate and the caps still size the buy.
  if (change?.reason.kind === 'core-fill') {
    return { action: 'buy', coreFill: true }
  }

  // The plan wants more of this name, or states no target at all: either way the evidence decides
  // whether adding is worth doing, as it does for a name the book has never held.
  if (change !== undefined || context.advice.kind !== 'ready' || held === undefined) {
    return scoreDirection(factors)
  }

  // No row from a plan that could have produced one. That is the book sitting where policy wants
  // it — unless the plan wanted more of this segment and could not fund it, which is a shortfall
  // wearing a conformance answer.
  return isUnfundedIncrease(context, input.market.manifest.segment)
    ? { action: 'hold', reasonCode: 'increase-unfunded' }
    : { action: 'hold', reasonCode: 'no-rebalance-needed' }
}

type DraftSale = Extract<DraftDirection, { readonly action: 'reduce' }>

interface LotScope {
  readonly held: HeldPosition
  readonly lotSize: number
}

/** The plan's trim: the share of the holding above the weight it targets. */
function trimOf(change: PositionChange | undefined): DraftSale | undefined {
  if (change === undefined || !(change.currentPctNav > change.targetPctNav)) {
    return undefined
  }

  return {
    action: 'reduce',
    reasonCode: 'over-target',
    saleFraction: 1 - change.targetPctNav / change.currentPctNav,
  }
}

/** A held name the evidence has turned on. Each reason cuts the position to what it leaves of the
 *  position as opened, so a reason that stays true sells once rather than again on every run: what
 *  has already been sold since the position opened counts toward it. A cut already made holds, and
 *  says why, so the name stays closed to a rebalance that would buy it back; so does a share still
 *  owed but under one board lot, which was never sold. */
function evidenceSaleFor(input: DirectionInput, held: HeldPosition): DraftDirection | undefined {
  const reason = reduceReasonFor(input, held)

  if (reason === undefined) {
    return undefined
  }

  const opened = held.units + (held.soldUnits ?? 0)
  const kept = (1 - saleFractionOf(reason, input.context.profile)) * opened
  const saleUnits = floorToLot(held.units - kept, input.market.manifest.boardLot.size)

  if (saleUnits > 0) {
    return {
      action: 'reduce',
      reasonCode: reason,
      saleFraction: Math.min(saleUnits / held.units, 1),
    }
  }

  return held.units - kept > OWED_RESIDUE_FRACTION * opened
    ? { action: 'hold', reasonCode: 'sale-below-board-lot', reduceReasonCode: reason }
    : { action: 'hold', reasonCode: 'evidence-sold', reduceReasonCode: reason }
}

/** The larger sale wins and keeps its own reason, so a second reason to sell a name never sells
 *  less than either alone would. Ordering them instead made the market's own full exit unreachable:
 *  `over-target` fires on any drift clearing a board lot, and a name that rose into its exit signal
 *  has drifted that far. Compared in board lots, since that is what either would sell: a tie goes to
 *  the evidence, whose reason keeps the name closed to `/rebalance`. Evidence that carries no share
 *  stands only where the trim is absent. */
function largerSaleOf(
  trim: DraftSale | undefined,
  evidence: DraftDirection | undefined,
  lot: LotScope
): DraftDirection | undefined {
  if (trim === undefined) {
    return evidence
  }

  return evidence?.action === 'reduce' && lotsSold(evidence, lot) >= lotsSold(trim, lot)
    ? evidence
    : trim
}

function lotsSold(sale: DraftSale, lot: LotScope): number {
  return floorToLot(sale.saleFraction * lot.held.units, lot.lotSize)
}

/** Most decisive first: a broken structure sells whatever the regime says, a risk-off regime sells
 *  a name the evidence no longer supports, and only then is a bearish read or a market's own
 *  overheating signal consulted. Stale is last, because every other reason already sells.
 *
 *  A failed breakout and a position that went nowhere are both readings of a short holding window:
 *  the first is the Turtle exit for a twenty-session entry, the second asks whether one outcome
 *  window decided anything. Over a quarter a ten-session low is noise and a flat quarter is the
 *  ordinary state of a holding, so neither reaches a long segment. */
function reduceReasonFor(
  input: DirectionInput,
  held: HeldPosition
): EvidenceReduceReasonCode | undefined {
  const { factors, context, market, horizon } = input
  // Masked, not returned: a long segment whose breakout failed, or whose name closed at the ceiling,
  // is still read for a risk-off regime and a bearish composite, as one without the signal.
  const signal =
    horizon === 'long' &&
    factors.reduceSignal !== undefined &&
    SHORT_HORIZON_SIGNALS.has(factors.reduceSignal)
      ? undefined
      : factors.reduceSignal
  const conclusive = isCompositeConclusive(factors)

  if (signal === 'structure-broken') {
    return signal
  }

  // Both conjuncts want a reading rather than an absence: an unrated macro reads risk-off by
  // default, and a score short of the bearish floor is the band the draft calls neutral.
  const regime = regimeFor(context.regimes, market.manifest.segment)

  if (conclusive && regime.rated && regime.regime === 'risk-off' && factors.bearish) {
    return 'regime-risk-off'
  }

  // Selling half a holding is a costlier act than declining to buy, so the bar is the band the
  // policy itself calls medium, not the draft's bearish floor. A fund is exempt for the reason the
  // averaging-down stage already states: an index has no single-name thesis to be wrong about, so a
  // bearish composite on one is a call on the market, which the segment's own weight answers. The
  // regime arm above still sells it, because a rated risk-off tape is exactly that call.
  if (
    conclusive &&
    factors.bearish &&
    factors.band !== 'low' &&
    input.instrumentKind !== ETF_KIND &&
    (horizon === 'short' || isBusinessWeakening(factors))
  ) {
    return 'thesis-weakening'
  }

  if (signal !== undefined) {
    return signal
  }

  return horizon === 'short' && isStale(input, held, horizon) ? 'stale' : undefined
}

/** A long holding is a bet on the business, so where the market reads the business the sale needs
 *  it read and turning against it. The annual reports decide where the market reads them; otherwise
 *  the business factors' lean does, and a composite that never looked at a filing is a price call
 *  wearing a thesis. A market that reads neither sells on its composite as before. */
function isBusinessWeakening(factors: FactorScore): boolean {
  if (factors.businessWeakening !== undefined) {
    return factors.businessWeakening
  }

  const business = factors.results.filter((result) => BUSINESS_FACTOR_IDS.has(result.id))

  if (business.length === 0) {
    return true
  }

  // The score, not its share: a business factor can be read while carrying no composite weight.
  const read = business.filter((result) => result.weight !== undefined)
  const lean = read.reduce((sum, result) => sum + result.score, 0)

  return read.length > 0 && lean < 0
}

/** Whether the composite may decide anything on its own. `scoreDirection` refuses a buy on either
 *  of these and names which one, so the two reasons here that read the composite clear the same
 *  bar; the tape's own exit signal and the staleness clock do not, because neither is a reading of
 *  it. A name whose accounts never landed scores on price alone and can still come back bearish at
 *  full band strength, which neither side acts on. */
function isCompositeConclusive(factors: FactorScore): boolean {
  return !(factors.coverageBelowMinimum || factors.agreementBelowMinimum)
}

function saleFractionOf(reason: EvidenceReduceReasonCode, profile: UserProfile): number {
  return reason === 'overheated' || reason === 'ceiling-close'
    ? profile.takeProfitTranchePct
    : REDUCE_SALE_FRACTIONS[reason]
}

/** Held for a whole outcome window and still within a rounding of its cost. Read off the book's own
 *  mark, so a name the valuation could not price is never called stale. */
function isStale(input: DirectionInput, held: HeldPosition, horizon: InvestmentHorizon): boolean {
  const { market, context, instrument } = input
  const mark = context.book.positions.find(
    (entry) => entry.kind === 'priced' && isSameInstrument(entry.position.instrument, instrument)
  )

  if (mark === undefined || mark.kind !== 'priced') {
    return false
  }

  return isPositionStale({ market, held, price: mark.price, asOf: input.asOf, horizon })
}

/** The side levels are built and the debate is framed against. A hold draft still frames as a buy —
 *  the operator asked about entering, and the deterministic read prices that question — except a
 *  weakening thesis on a held name, where the question being priced is the exit. */
export function levelDirectionFor(direction: DraftDirection): SuggestionDirection {
  return direction.action === 'reduce' ? 'reduce' : 'buy'
}

interface DirectionInput {
  readonly context: SuggestionPortfolioContext
  readonly instrument: InstrumentRef
  readonly market: Market
  /** The window the call is for: the focus's own, else the segment's. */
  readonly horizon: InvestmentHorizon
  readonly asOf: TradingDay
  readonly factors: FactorScore
  readonly upcomingEvents: readonly MarketEvent[]
  /** Undefined where the market resolved no class, which reads as a single name: the fund
   *  exemption is the narrow claim, so an unknown kind keeps the ordinary rule. */
  readonly instrumentKind: InstrumentKind | undefined
}

function isSegmentOff(profile: UserProfile, segment: PortfolioSegment): boolean {
  const caps = profile.caps[segment]

  return caps !== undefined && isSegmentDisabled(caps)
}

function isTargetZero(profile: UserProfile, segment: PortfolioSegment): boolean {
  return profile.segmentTargets[segment] === 0
}

/** The plan stopped this segment short of policy and named cash as the reason. Read per segment,
 *  because each gets its own slice of the deployable pool: a segment that ran out says nothing about
 *  a neighbour whose budget went unspent. */
function isUnfundedIncrease(
  context: SuggestionPortfolioContext,
  segment: PortfolioSegment
): boolean {
  if (context.advice.kind !== 'ready') {
    return false
  }

  const entry = context.advice.allocation.find((row) => row.segment === segment)
  const underfunded = context.advice.caveats.some(
    (caveat) =>
      caveat.code === 'portfolio.increases-underfunded' && caveat.detail?.segment === segment
  )

  return underfunded && entry !== undefined && entry.afterPlanPctNav < entry.targetPctNav
}

/** Conviction reads strength, not sign, so nothing downstream except the debate would stop a
 *  bearish composite from being drafted as a confident buy. Both conclusiveness bars come first, as
 *  they do on the reduce side: a composite too few factors reached is a data gap whatever sign it
 *  carries, and takes the code the reuse gate does not cache. A contested one - factors pulling hard
 *  in opposite directions - holds for the reason the board already rates it contested. A read that
 *  clears both bars and neither draft floor is the band between them, where buying acts on nothing. */
function scoreDirection(composite: FactorComposite): DraftDirection {
  if (composite.coverageBelowMinimum) {
    return { action: 'hold', reasonCode: 'insufficient-data' }
  }

  if (composite.agreementBelowMinimum) {
    return { action: 'hold', reasonCode: 'factors-contested' }
  }

  if (composite.bearish) {
    return { action: 'hold', reasonCode: 'factors-bearish' }
  }

  return composite.bullish ? { action: 'buy' } : { action: 'hold', reasonCode: 'factors-neutral' }
}

/** What the plan wants this name to weigh. The trim says how far the book has drifted; this says
 *  where it is drifting to, which is what separates trimming a winner from a thesis that broke.
 *  Undefined wherever `planChangeOf` is, and for the same reason. */
export function targetWeightOf(
  context: SuggestionPortfolioContext,
  instrument: InstrumentRef
): number | undefined {
  return planChangeOf(context, instrument)?.targetPctNav
}

/** The plan's row for this name. Undefined when no row steers it — advice that could not be built,
 *  or a name the plan left alone — which is not the same claim as a zero gap. */
function planChangeOf(
  context: SuggestionPortfolioContext,
  instrument: InstrumentRef
): PositionChange | undefined {
  return context.advice.kind === 'ready'
    ? context.advice.rebalance.find((row) => isSameInstrument(row.instrument, instrument))
    : undefined
}
