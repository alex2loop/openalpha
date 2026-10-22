import type { PreviewLedgerOptions, RecordPreview } from '@/trading/features/ledger/preview'
import type {
  LedgerEntry,
  LedgerEntryView,
  LedgerPageOptions,
  LedgerWriteResult,
} from '@/trading/features/ledger/types'
import type { VenueReconciliation } from '@/trading/features/portfolio/folds/reconcile'
import type {
  PortfolioAtOptions,
  RebalanceOptions,
  RecordLedgerOptions,
  RemoveLedgerOptions,
  UpdateLedgerOptions,
} from '@/trading/features/portfolio/options'
import type { RelativePortfolioView } from '@/trading/features/portfolio/relative-view'
import type {
  Caveat,
  CaveatDetail,
  EvidenceReduceReasonCode,
  PortfolioEvidenceKind,
  PortfolioFindingKind,
} from '@/trading/kernel/caveat'
import type {
  CurrencyCode,
  InstrumentKind,
  InstrumentRef,
  MarketRef,
  PortfolioSegment,
  TradingDay,
  VenueRef,
} from '@/trading/kernel/instrument'
import type { QuoteFreshness, RegimeScale } from '@/trading/kernel/market/market-data'
import type {
  Book,
  CashPosture,
  CurrencyCash,
  LedgerEntryId,
  Position,
  PriceFreshness,
} from '@/trading/kernel/operator/book'
import type { ProfileStamp } from '@/trading/kernel/operator/profile'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { Page } from '@/trading/kernel/store/page'

interface StandingReduceOptions {
  readonly instruments: readonly InstrumentRef[]
  readonly signal: AbortSignal
}

/** Which held names the newest stored verdict says to sell on evidence, so a plan built from
 *  weights alone cannot propose buying one. Implemented against the suggestion store and bound in
 *  wiring: the book states what it needs and never reads a suggestion row itself. */
export interface ReduceVerdicts {
  /** Keyed by `buildInstrumentKey`. A name absent from the map carries no such verdict; an
   *  `over-target` trim is never here, because that is this fold's own drift rule handed back. */
  standing(options: StandingReduceOptions): Promise<ReadonlyMap<string, EvidenceReduceReasonCode>>
}

export interface SegmentValue {
  readonly segment: PortfolioSegment
  readonly valueBase: number
  /** Share of NAV as a fraction: 0.583 is 58,3%. Every `*PctNav` in this module is a fraction. */
  readonly weightPctNav: number
  /** The ETF share of NAV inside this segment, as a fraction. `0` is measured and none; absent means
   *  a priced holding here resolved no kind, so the segment cannot be measured — which every ETF
   *  ceiling reads as no room, never as compliant. */
  readonly etfPctNav?: number
}

export interface SectorValue {
  readonly sector: string
  readonly valueBase: number
  /** Share of NAV as a fraction: 0.583 is 58,3%. Every `*PctNav` in this module is a fraction. */
  readonly weightPctNav: number
}

/** A tagged union rather than an optional-field record: a caller switching on `kind` gets
 *  exhaustiveness checking instead of having to remember that a price and a caveat are mutually
 *  exclusive. */
/** One instrument's whole holding, however many venues it is spread across. Exposure, sector caps
 *  and the rebalancer all read total exposure, so valuation groups by instrument and keeps the
 *  split beside it rather than valuing the same coin twice. */
export type Holding = Omit<Position, 'venue'> & {
  /** Present only when the holding spans more than one venue. Absent is not a split of one. */
  readonly venueSplit?: readonly { readonly venue: VenueRef; readonly units: number }[]
}

export type ValuedPosition =
  | {
      readonly kind: 'priced'
      readonly position: Holding
      readonly priceBase: number
      /** The mark in the quoting market's own currency, for the price rows. Money lines take the
       *  base-currency pair beside it; a price never converts, because the convention its market
       *  quotes in is part of the reading. */
      readonly price: number
      readonly valueBase: number
      /** Which reading the mark is and when, exactly as the quoting market stamped it. `Book.asOf`
       *  is the ledger day being viewed, which is not the session the price came from: before
       *  today's close a settled mark is yesterday's. */
      readonly observed: QuoteFreshness
      /** Share of NAV as a fraction. Absent exactly when NAV is: a book with an unpriced holding
       *  has no denominator, and a weight against a partial NAV is wrong in a way that looks
       *  authoritative. */
      readonly weightPctNav?: number
      /** The quoting market's own day change, percent-valued. Absent where the market publishes
       *  none, which is different from a flat session. */
      readonly changePct?: number
      /** What the holding last closed at and on which session, in the book's currency and converted
       *  at the same rate as the mark beside it. */
      readonly previousClose?: ValuedClose
      /** The mark is a dealer board's buy price: a quote read at an instant, not a trade or a close. */
      readonly dealerBuy?: true
    }
  | { readonly kind: 'unpriced'; readonly position: Holding; readonly caveat: Caveat }

/** A settled close as the book sees it: converted to base, and dated by the session it came from. */
export interface ValuedClose {
  readonly priceBase: number
  /** The same close in the quoting market's own currency. A price row prints this one: a crypto
   *  close translated to the book's currency is a number that market never quoted. */
  readonly price: number
  readonly at: TradingDay
  /** What that session moved against the one before it. Absent when the series has no prior close;
   *  never zero, which would claim a flat session. */
  readonly changePct?: number
}

/** What the book made or lost today. Summed from the positions whose market publishes a day change
 *  and absent when none does, because zero would assert a flat session the data never claimed. */
export interface BookDayChange {
  readonly amountBase: number
  /** Against what the book was worth before today's move, as a fraction. */
  readonly fraction: number
  /** The oldest session this sum measures. Legs on different markets close on different days, so
   *  the figure is only as current as its weakest one. */
  readonly at: TradingDay
}

export interface ValuedCurrencyCash {
  readonly cash: CurrencyCash
  readonly valueBase?: number
}

export interface ValuedBook {
  readonly book: Book
  readonly positions: readonly ValuedPosition[]
  /** How the marks behind this valuation were taken; absent when nothing was priced. */
  readonly freshness?: PriceFreshness
  readonly navBase?: number
  /** Absent when no priced holding's market published a day change, or when NAV is unknown. */
  readonly dayChange?: BookDayChange
  /** What the open positions cost all-in, fees included, not what they are worth now: cash + this +
   *  `unrealizedPnlBase` + `currencyCashGainBase` is NAV, which is what lets a reader check the block
   *  against itself. */
  readonly investedBase?: number
  /** How much of `investedBase` was fee rather than fill — a part of it, never a term to add to
   *  it. Absent whenever `investedBase` is. */
  readonly feesBase?: number
  readonly unrealizedPnlBase?: number
  /** The currency-move share of `unrealizedPnlBase`: what today's FX rate did to the capital
   *  invested in foreign-currency holdings, `costBasisNative × rate − costBasisBase` summed over
   *  them. The remainder is the market's own move at today's rate; the two sum exactly to the
   *  total. Absent when every holding is in the base currency or when NAV is unknown. */
  readonly unrealizedFxPnlBase?: number
  readonly currencyCash: readonly ValuedCurrencyCash[]
  /** Today's value of the currency cash over its cost. Absent when the book holds none or NAV is
   *  unknown. */
  readonly currencyCashGainBase?: number
  /** Never absent, unlike the three above: cash and cost basis alone settle what the closed trades
   *  did, so an unpriced position withholds NAV without withholding this. */
  readonly realizedPnlBase: number
  readonly segmentValues: readonly SegmentValue[]
  readonly sectorValues: readonly SectorValue[]
  readonly caveats: readonly Caveat[]
}

export interface PortfolioEvidence {
  readonly kind: PortfolioEvidenceKind
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

export interface PortfolioAssessment {
  readonly findings: readonly PortfolioFinding[]
  readonly caveats: readonly Caveat[]
}

export interface PortfolioFinding {
  readonly kind: PortfolioFindingKind
  readonly direction: 'positive' | 'negative'
  /** The values this finding's message interpolates — who it is about (`{ticker}`, `{segment}`,
   *  `{sector}`, `{group}`) and, where it crossed a limit, the pair that says so (`{weight}` against
   *  `{cap}` or `{target}`, percent-valued) or `{days}`. Required, not optional: without it a
   *  portfolio holding three concentrated names emits three identical findings and the operator
   *  cannot tell which names they are. */
  readonly subject: CaveatDetail
  readonly evidence: readonly PortfolioEvidence[]
}

export const REBALANCE_UNAVAILABLE_REASONS = Object.freeze([
  'zero-nav',
  'incomplete-valuation',
  'insufficient-policy-input',
  'unresolved-names',
] as const)
export type RebalanceUnavailableReason = (typeof REBALANCE_UNAVAILABLE_REASONS)[number]

export type RebalancePlanResult = RebalancePlanReady | RebalancePlanUnavailable

export interface RebalancePlanReady extends PortfolioAssessment {
  readonly kind: 'ready'
  readonly policy: RebalancePolicyView
  readonly allocation: readonly SegmentTarget[]
  readonly rebalance: readonly PositionChange[]
  readonly cashSegment: CashSegmentTarget
  readonly weakHoldings: readonly WeakHoldingNote[]
}

/** The policy this run was shaped by, so a reader can tell advice built on their own settings from
 *  advice built on seeded defaults. */
export interface RebalancePolicyView {
  readonly profile: ProfileStamp
  /** What actually scaled today's buys: the tighter of the macro read and the profile ceiling. The
   *  remaining caps are named by the caveat of whichever one bound, never listed up front. */
  readonly deploymentScale: number
}

/** Money for one order, kept beside the advice rather than inside it: `RebalancePlanResult` reaches an
 *  agent and must stay relative, while the operator placing the order needs an amount and a count. */
export interface OrderSize {
  readonly valueBase: number
  readonly quantity: number
  /** The smallest quantity this instrument's venues accept, carried by the fold that already
   *  rounded to it, so a surface splitting the order into tranches lands on a fillable count. */
  readonly boardLot: number
  /** The mark `quantity` was divided out of, in the book's base currency. Stated so a row says what
   *  it was sized against rather than leaving the reader to divide. */
  readonly unitPriceBase: number
  /** The same mark in the quoting market's own currency — what an order line quotes. */
  readonly unitPrice: number
  readonly currency: CurrencyCode
}

/** Keyed by `buildInstrumentKey`, so a row finds its own size without either side carrying the other. */
export interface RebalanceSizing {
  readonly navBase: number
  readonly baseCurrency: CurrencyCode
  readonly byInstrument: ReadonlyMap<string, OrderSize>
}

/** The operator-only read: the same advice, plus the money an order needs. `sizing` is null exactly
 *  when the advice could not be sized at all. */
export interface AbsoluteRebalancePlan {
  readonly advice: RebalancePlanResult
  readonly sizing: RebalanceSizing | null
  /** The macro read behind every number above, per segment: each market's own macro caps its own
   *  segment, so VN stress cannot size a crypto order. Empty on the arm that returns before the
   *  read, which `regimeFor` reads defensively. */
  readonly regimes: ReadonlyMap<PortfolioSegment, RegimeScale>
  /** How the marks behind this advice were taken; absent when nothing was priced. */
  readonly freshness?: PriceFreshness
  /** The valued book every number above was measured against. Carried for the same reason `regime`
   *  is: a reader that valued the book a second time would quote every holding again at the same
   *  instant and reason over marks the sizing never saw. Absent only on the arm that returns before
   *  any valuation, which is the unresolved-names one. */
  readonly book?: ValuedBook
}

export interface WeakHoldingNote {
  readonly instrument: InstrumentRef
  readonly signal: number
}

interface RebalancePlanUnavailable extends PortfolioAssessment {
  readonly kind: 'unavailable'
  readonly reason: RebalanceUnavailableReason
}

/** Which of the five limits held a candidate back. Naming it is what turns "every name hit a size
 *  limit" into something the operator can act on, since each one is raised a different way. The
 *  segment ceiling is not among them: a segment is distributed up to its target, and the profile
 *  validator holds the ceiling at or above that target, so it can never be the binding one here. */
export const CAP_REASONS = Object.freeze([
  'position',
  'market',
  'liquidity',
  'sector',
  'etf',
] as const)
export type CapReason = (typeof CAP_REASONS)[number]

export interface CashSegmentTarget {
  /** Settled cash once this plan's purchases are paid for. Unsettled sale proceeds are excluded:
   *  the reserve and the deposit can only be funded by money that has cleared. */
  readonly cashPctNav: number
  /** The reserve actually held, which is `reservePctNav` capped by the cash there is — not a target
   *  the book is steered toward. The segment's own target is the cash row in `allocation`. */
  readonly liquidReservePctNav: number
  readonly termDepositEligiblePctNav: number
  readonly posture: CashPosture
  readonly caveats: readonly Caveat[]
}

/** Two different questions, so two fields: `targetPctNav` is policy and never moves, while
 *  `afterPlanPctNav` is where the segment lands once the plan's orders are placed — already net of
 *  lot rounding, available cash, and the deployment cap. Why a segment stops short of policy is the
 *  residue caveats' job, in words; a second number for it only invites the two to disagree. */
export interface SegmentTarget {
  readonly kind: 'segment-target'
  readonly segment: PortfolioSegment
  readonly currentPctNav: number
  readonly targetPctNav: number
  readonly afterPlanPctNav: number
  /** The drift this segment was allowed, from the policy the plan was built with. Inside it the
   *  planner passed over the segment on purpose; carrying it here is what keeps a surface from
   *  re-deriving the band and disagreeing with the plan it is printing. */
  readonly driftBandPctNav: number
  /** The segment ceiling the segment is held under, so the plan can be checked against the cap that
   *  sized it, not only against the target it drifts toward. Absent for cash, which is bounded by a
   *  reserve floor and has no ceiling to report. */
  readonly capPctNav?: number
  readonly etfPctNav?: number
  readonly etfCapPctNav?: number
}

/** The portfolio surface an agent may hold: the relative reads and the mutations, never the two
 *  absolute-money reads. A compile-time Pick rather than a runtime filter, so money and quantities
 *  are not representable to a tool at all (spec §13). Its home is here because it is this service's
 *  own narrowing; wiring only binds it.
 *
 *  Declared below `PortfolioService` in reading order but above every consumer outside the
 *  feature. */
export type AgentPortfolio = Pick<
  PortfolioService,
  | 'record'
  | 'previewRecord'
  | 'recordVenues'
  | 'venuesHolding'
  | 'update'
  | 'remove'
  | 'historyRelative'
  | 'viewRelative'
  | 'assess'
  | 'rebalance'
  | 'rebalanceWithUnits'
>

/** Why the row is in the plan. Only the pass that built it knows, and a sell the operator cannot
 *  trace back to a cause is one they have to reverse-engineer. */
export type ChangeReason =
  | { readonly kind: 'fill-gap' | 'core-fill' }
  | { readonly kind: 'trim' | 'off-policy' }
  | { readonly kind: 'weak-signal'; readonly signal: number }
  | { readonly kind: 'over-cap'; readonly limit: CapReason; readonly cap: number }

export interface PositionChange {
  readonly kind: 'position-change'
  readonly instrument: InstrumentRef
  readonly segment: PortfolioSegment
  /** The industry the row moves, where the market names one. A sectorless row moves no sector
   *  weight, which the post-plan line reads as nothing to adjust rather than as zero. */
  readonly sector?: string
  /** The record's own kind, carried from the candidate that sized it. A row whose kind never
   *  resolved prints bare — no badge beats a guessed one. */
  readonly instrumentKind?: InstrumentKind
  readonly currentPctNav: number
  readonly targetPctNav: number
  readonly changePctNav: number
  /** Whole units the change works out to, lot-rounded. Only `rebalanceWithUnits` sets it. */
  readonly units?: number
  readonly reason: ChangeReason
  readonly caveats: readonly Caveat[]
}

/** A venue and the markets it can hold. */
export interface VenueChoice {
  readonly venue: VenueRef
  readonly markets: readonly MarketRef[]
}

/** The valued book and, by instrument key, the smallest order any venue holding it accepts. */
export interface SizedValuedBook {
  readonly valued: ValuedBook
  readonly minimumSizes: ReadonlyMap<string, number>
}

export interface PortfolioService {
  record(options: RecordLedgerOptions): Promise<LedgerWriteResult>
  previewRecord(options: PreviewLedgerOptions): Promise<RecordPreview>
  /** Which custodians a recorded row may land at when the operator names none — one member is the
   *  answer, more is a choice only the operator can make. */
  recordVenues(market: MarketRef): readonly VenueRef[]
  /** Every registered custodian that holds this market - what a row the operator named a venue on
   *  is allowed to say, which is wider than `recordVenues` whenever config pins a default. */
  venuesHolding(market: MarketRef): readonly VenueRef[]
  /** Every registered venue with the markets it holds, in registration order. */
  venueChoices(): readonly VenueChoice[]
  /** Whether the operator has recorded or corrected a row for this instrument since `since`. A
   *  reader holding something derived from the book asks this rather than re-deriving it. */
  hasTradedSince(instrument: InstrumentRef, since: number, signal: AbortSignal): Promise<boolean>
  update(options: UpdateLedgerOptions): Promise<LedgerWriteResult>
  remove(options: RemoveLedgerOptions): Promise<LedgerWriteResult>
  historyRelative(options: LedgerPageOptions): Promise<Page<LedgerEntryView, LedgerEntryId>>
  viewRelative(options: PortfolioAtOptions): Promise<RelativePortfolioView>
  assess(options: PortfolioAtOptions): Promise<PortfolioAssessment>
  rebalance(options: RebalanceOptions): Promise<RebalancePlanResult>
  /** The relative plan plus each row's `units`, for the operator's own MCP client: the quantity a
   *  broker order needs, never an order value or the book's money. */
  rebalanceWithUnits(options: RebalanceOptions): Promise<RebalancePlanResult>
  /** Operator-only, like the other absolute reads: it carries the order value and unit count an
   *  agent must never see. */
  rebalanceAbsolute(options: RebalanceOptions): Promise<AbsoluteRebalancePlan>
  historyAbsolute(options: LedgerPageOptions): Promise<Page<LedgerEntry, LedgerEntryId>>
  viewAbsolute(options: PortfolioAtOptions): Promise<ValuedBook>
  /** Operator-only: the valued book plus each held name's smallest venue order size, so the
   *  operator's own screens leave out what no venue would fill, as `/portfolio` does. */
  viewAbsoluteSized(options: PortfolioAtOptions): Promise<SizedValuedBook>
  /** Operator-only, like the other absolute reads: the valued book plus, per instrument key, the
   *  kind the stored record files it under. One read serves both, so the rows cannot disagree with
   *  the marks; a renderer cannot reach the store, so the command resolves one map for the book. */
  viewAbsoluteWithKinds(options: PortfolioAtOptions): Promise<{
    readonly valued: ValuedBook
    readonly instrumentKinds: ReadonlyMap<string, InstrumentKind>
  }>
  positionsAt(options: PortfolioAtOptions): Promise<readonly Position[]>
  /** The book held against each venue's own balances. Read-only; a venue with no balance feed, or
   *  no credentials, answers `unsupported`. */
  reconcile(options: PortfolioAtOptions): Promise<readonly VenueReconciliation[]>
}
