import type { ChannelId } from '@/core/channels'
import type { RunId, SessionId } from '@/core/ids'
import type { Budget } from '@/core/types/budget'
import type { Locale } from '@/core/types/locale'
import type { Caveat } from '@/trading/kernel/caveat'
import type { BandCounts } from '@/trading/kernel/conviction'
import type { FactorComposite, FactorResult } from '@/trading/kernel/factor'
import type {
  AssetClass,
  CurrencyCode,
  InstrumentKind,
  InstrumentRef,
  MarketRef,
  PriceDisplay,
  QuoteUnit,
  Region,
  Ticker,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type {
  MarketRegime,
  Quote,
  QuoteFreshness,
  SessionSoFar,
} from '@/trading/kernel/market/market-data'
import type { MarketMovers } from '@/trading/kernel/market/market-overview'
import type { TapeSignal } from '@/trading/kernel/market/tape'
import type { ScreenCautionCode, ScreenGateCode } from '@/trading/kernel/screen-codes'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'

export interface MarketRequest {
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

export interface InstrumentRequest extends MarketRequest {
  readonly instrument: InstrumentRef
}

export interface RegionRequest extends MarketRequest {
  readonly region: Region
}

export interface BarsRequest extends InstrumentRequest {
  readonly sessions: number
}

/** A quote is always the freshest reading the market can give: the intraday price where its session
 *  is open and an intraday series exists, and the last settled close otherwise. Which of the two
 *  arrived is answered by the freshness stamp, never asked for by the caller. */
export type QuoteRequest = InstrumentRequest

/** `withPreviousClose` costs a read of the market's daily series, so it is asked for by the surfaces
 *  that print the settled close beside the live one and skipped by the scheduled paths — an alert
 *  compares a price against a threshold and never renders the session behind it. */
export interface PreviousCloseOption {
  readonly withPreviousClose?: boolean
}

/** Corporate events are dated by ex-right date, so the adapter needs the range's start; `asOf` from
 *  `MarketRequest` is its end. Without it the source has nothing to filter on. */
export interface EventsRequest extends InstrumentRequest {
  readonly fromDay: TradingDay
}

export interface NewsRequest extends MarketRequest {
  readonly instrument?: InstrumentRef
  readonly region?: Region
  readonly limit: number
}

export interface FlowsRequest extends MarketRequest {
  readonly instrument?: InstrumentRef
}

export interface ScreenRequest extends MarketRequest {
  readonly market: MarketRef
  readonly limit: number
  /** Narrows the board to one kind of instrument; the market declares which it has. */
  readonly instrumentKind?: InstrumentKind
  /** Narrows the board to these sectors, as the market files them. Applied before the rank and the
   *  cut, so the board is the sector's best and its header counts the sector. */
  readonly sectors?: readonly string[]
}

/** The brief is the one market capability that is user-scoped: four of its sections answer "what
 *  happened to *you* since last time". `BriefService` owns snapshot persistence and therefore owns
 *  deriving `activitySince` and `previousDay` from the previous snapshot — the market composes
 *  sections and never reads the snapshot store. */
export interface MarketBriefRequest extends MarketRequest {
  readonly region: Region
  readonly locale: Locale
  readonly watchlist: readonly InstrumentRef[]
  /** The prior brief's complete eligible set, supplied by the brief service for dropped-name
   *  comparison. Absent on a user's first brief. */
  readonly previousEligibleWatchlist?: readonly InstrumentRef[]
  readonly limit: number
  /** Exclusive lower bound for "since your last brief": the previous snapshot's `createdAt`, or
   *  `now - BriefPolicy.activityLookbackMs` when the user has never had one. */
  readonly activitySince: number
  /** Whether this month's scorecard has already been delivered. `BriefService` owns the test for
   *  the same reason it owns `previousDay`'s replacement: only it reads the snapshot chain. */
  readonly scorecardShownThisMonth: boolean
  readonly channel: ChannelId
  readonly billingSessionId: SessionId | null
  /** The brief's own slice; the suggestion sections draw from it and never from the parent. */
  readonly budget: Budget
  readonly parentRunId?: RunId
  /** What the build spent. A section that reaches a model adds its results' usage here. */
  /** Present when a surface is waiting on this build; the suggestion sections report through it. */
  readonly progress?: StageReporter
}

/** Dated per name rather than per board: a name halted through a session has its newest bar behind
 *  the board's own `dataThroughDay`. */
export interface PreviousClose {
  readonly price: number
  readonly at: TradingDay
  /** What that session moved, against the one before it. Absent where the surface knows only the
   *  price — the row then states the close alone rather than implying a flat session. */
  readonly changePct?: number
}

/** A price alone is ambiguous: the unit and currency live on the quoting market's manifest, which no
 *  surface may reach. The service stamps both here so a renderer can state what the number means. */
export interface QuoteView {
  readonly quote: Quote
  /** How this reading prints. All three are absent together for a level, which has no board scale
   *  to divide by and no currency to name — the read decides, so no surface resolves a second one. */
  readonly unit?: QuoteUnit
  readonly currency?: CurrencyCode
  readonly display?: PriceDisplay
  /** Which reading this is and when, on the quoting market's own clock and calendar — the only
   *  owner of the answer. The same shape a quoteBoard row carries, so one sentence describes both. */
  readonly observed: QuoteFreshness
  /** The settled session behind this reading, from the market's own daily series. Absent where the
   *  market publishes no bars or the read failed — the quote stands without it. */
  readonly previousClose?: PreviousClose
}

export interface ScreenCandidate {
  readonly instrument: InstrumentRef
  /** The company or coin as its listing names it, where the market's catalog carries one. A
   *  surface showing the board beside the ticker reads it here rather than looking it up per row. */
  readonly name?: string
  /** The market's sector slug for the name, where it files one. */
  readonly sector?: string
  /** The whole fold, not its parts: the rank, how much of the model stood behind it, whether the
   *  factors agreed, and the band that reads all three. Splitting them let a row show a score with
   *  no scale beside it. */
  readonly composite: FactorComposite
  readonly factors: readonly FactorResult[]
  /** What the name costs, and which reading that is. A market still trading answers `live`; one
   *  that has closed answers `close`, the very session the rank was built on. Both are carried,
   *  because a board with no price at all is the less useful half of the distinction. */
  readonly price?: ScreenPrice
  /** The settled close the rank was built on. Carried by the market rather than fetched: the scored
   *  series already holds it. Absent where the market publishes no settled series. */
  readonly previousClose?: PreviousClose
  /** The price at or above which the name is locked at its daily ceiling and cannot be bought at a
   *  price anyone would want. Published by markets that impose a band; absent where none applies. */
  readonly lockPrice?: number
  /** Standard deviation of daily returns over the market's own volatility window, which is what
   *  makes a move away from `previousClose` readable as ordinary or as a different market. */
  readonly volatilityDaily?: number
  /** The live reading where the market already held one — a universe sweep answers with prices, and
   *  requesting them again per name spends a rate limit on data in hand. `price` is stamped from it.
   *  Absent where only a per-name quote can answer. */
  readonly liveQuote?: Quote
  /** Set where a standing fact or the live price contradicts the rank rather than merely updating
   *  it. A market publishes one it knows from stored evidence; the price overlay adds one from the
   *  live tick and never overwrites a published one. */
  readonly caution?: ScreenCautionCode
  /** What the last settled session's tape said about this name, beyond the factors. Absent where
   *  the market publishes no such read. */
  readonly signals?: readonly TapeSignal[]
}

export interface ScreenPrice {
  readonly quote: Quote
  /** The same shape a quoteBoard row carries, so one sentence describes how fresh a price is. */
  readonly observed: QuoteFreshness
}

/** Why one name the screen reached is absent from `candidates`, carrying the first gate it failed. */
export interface ScreenRejection {
  readonly instrument: InstrumentRef
  readonly code: ScreenGateCode
}

export interface ScreenResult {
  readonly asOf: TradingDay
  /** The last settled session the evidence actually ends at. Intraday this trails `asOf` by one
   *  session, and the header must say so — a board dated today wearing yesterday's closes reads as
   *  a claim about a session that has not settled. Absent when the market cannot say (an empty
   *  universe), in which case surfaces fall back to `asOf`. */
  readonly dataThroughDay?: TradingDay
  /** The quoting market's currency, present whenever candidates carry live quotes to price. */
  readonly currency?: CurrencyCode
  /** The clock `asOf` and `dataThroughDay` are days of — a crypto board is dated by the UTC day. */
  readonly timezone?: string
  /** What kind of board this is. `rank` orders a population against itself and is the default every
   *  market with a population produces. `gate` states, per name, whether it cleared - a segment whose
   *  members are correlated has no population to rank, and a heading that said "top 2 of 3" would
   *  claim a selection the composite cannot make. */
  readonly board?: 'rank' | 'gate'
  readonly candidates: readonly ScreenCandidate[]
  readonly rejections: readonly ScreenRejection[]
  readonly universeSize: number
  /** How the whole scored board banded, before it was truncated to the requested size. Absent where
   *  no board was scored: a board of nothing has no distribution to report. */
  readonly bandCounts?: BandCounts
  /** What moved most in the universe this board was drawn from, above its liquidity floor and past
   *  what the board can trade. Ungated: a name here is not a candidate, and several failed a gate
   *  above. Absent where the market publishes no per-name session change. */
  readonly movers?: MarketMovers
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

/** One sector's standing against the market's own benchmark, over the roll-up's two windows. */
export interface SectorStrength {
  readonly sector: string
  readonly memberCount: number
  /** This session's capitalisation-weighted move across members that traded it. The excess returns
   *  below are 20- and 60-session leadership; this is the only field that answers "today". */
  readonly sessionReturn?: number
  /** Leadership over the index. Absent, with `score`, where the market's index series could not
   *  answer the window: an excess against nothing is the sector's own return wearing a lead. */
  readonly excessReturnShort?: number
  readonly excessReturnLong?: number
  readonly foreignNetBase: number
  readonly score?: number
}

export interface SectorStrengthResult {
  readonly asOf: TradingDay
  readonly sectors: readonly SectorStrength[]
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

/** Window statistics a market measures over its own lookback. `averageDailyTurnover` is in the
 *  market's currency; `volatilityDaily` is a unitless close-to-close standard deviation. */
export interface InstrumentStatistics {
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  readonly sessions: number
  /** Absent where the market could not measure the window, like `volatilityDaily` beside it: a
   *  zero here is a liquidity ceiling nobody measured. */
  readonly averageDailyTurnover?: number
  readonly volatilityDaily?: number
}

/** The durable derived artifact, distinct from the provider `MacroSnapshot` payload it was built
 *  from: it carries the market's own regime, every contributing source stamp, and the caveats that
 *  qualify it, so a brief re-reads the read that happened rather than re-deriving a neutral one. */
export interface MacroRiskSnapshot {
  readonly region: Region
  readonly asOf: TradingDay
  readonly createdAt: number
  readonly formulaVersion: string
  readonly values: Readonly<Partial<Record<MacroSeriesId, number>>>
  readonly observationDates: Readonly<Partial<Record<MacroSeriesId, TradingDay>>>
  readonly regime: MarketRegime
  /** The score's own band after hysteresis. Absent when too few drivers voted to rate it, since an
   *  outage day's default is not a reading the next day may lean on. */
  readonly scoreRegime?: MarketRegime
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

export interface FuturesBasis {
  readonly asOf: TradingDay
  readonly spot: number
  readonly future: number
  readonly basis: number
  readonly basisPct: number
  readonly contractCode: string
  /** Absent when the provider lists the contract without a maturity, as it does for a rolling
   *  front-month alias. */
  readonly expiry?: TradingDay
}

export interface QuoteBoardRequest {
  readonly instruments: readonly InstrumentRef[]
  readonly signal: AbortSignal
}

export interface QuoteBoard {
  readonly items: readonly QuoteBoardItem[]
  readonly caveats: readonly Caveat[]
}

export interface QuoteBoardItem {
  readonly ticker: Ticker
  readonly region: Region
  readonly currency: CurrencyCode
  readonly kind: Exclude<InstrumentKind, 'fx'>
  readonly market: MarketRef
  readonly assetClass: AssetClass
  readonly last: number
  readonly changePct?: number
  readonly observed: QuoteFreshness
  /** The session `last` closed in, once that session has settled. Absent on a live reading, and on
   *  a reading too old to be live from a session still trading, which is no close at all. */
  readonly closedOn?: TradingDay
  /** The settled close `last` moved from, so a row states both readings rather than one. */
  readonly previousClose?: PreviousClose
  /** Volume the session has accumulated, absent where the provider serves no intraday series. Zero
   *  separates a name that has not traded today from one that traded and closed unchanged. */
  readonly sessionVolume?: number
  /** What the intraday series has recorded today. Absent on a close, and on a live read from a
   *  provider that serves no intraday series — the same condition `sessionVolume` answers for. */
  readonly session?: SessionSoFar
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

export interface FxConversion {
  readonly fromCurrency: CurrencyCode
  readonly toCurrency: CurrencyCode
  readonly rate: number
  readonly source: 'identity' | 'provider' | 'operator'
  readonly sourceId?: SourceId
  readonly asOf: TradingDay
  readonly fetchedAt?: number
}
