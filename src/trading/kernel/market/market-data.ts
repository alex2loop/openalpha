import type { Caveat, InstrumentStatus } from '@/trading/kernel/caveat'
import type {
  CurrencyCode,
  InstrumentKind,
  InstrumentRef,
  MarketRef,
  Region,
  TradingDay,
  VnGoldForm,
  VnIndexTier,
} from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { SourceId } from '@/trading/kernel/source/source-id'

export const BAR_ADJUSTMENTS = Object.freeze(['adjusted', 'raw'] as const)
export type BarAdjustment = (typeof BAR_ADJUSTMENTS)[number]

export const MARKET_EVENT_KINDS = Object.freeze([
  'dividend-ex-date',
  'agm',
  'meeting-ex-date',
  'split',
  'rights-issue',
  'additional-listing',
  'listing',
  'delisting',
  'last-trading-day',
  'margin-eligible',
  'margin-ineligible',
] as const)
export type MarketEventKind = (typeof MARKET_EVENT_KINDS)[number]

export const INDEX_REVIEW_KINDS = Object.freeze(['ftse-geis', 'hose'] as const)
export type IndexReviewKind = (typeof INDEX_REVIEW_KINDS)[number]

/** ICB level 2, the taxonomy VN providers publish and the granularity the sector roll-up reads.
 *  Membership is the standard's, not ours: GAS distributes gas, so ICB files it under `utilities`
 *  where a press "dầu khí" table — the PetroVietnam family, which is no ICB bucket — would not.
 *  Listed here only to carry a translation; a provider string with no entry renders as itself. */
export const ICB_SUPERSECTORS = Object.freeze([
  'automobiles-parts',
  'banks',
  'basic-resources',
  'chemicals',
  'construction-materials',
  'financial-services',
  'food-beverage',
  'health-care',
  'industrial-goods-services',
  'insurance',
  'media',
  'oil-gas',
  'personal-household-goods',
  'real-estate',
  'retail',
  'technology',
  'telecommunications',
  'travel-leisure',
  'utilities',
] as const)

export const MARKET_REGIMES = Object.freeze(['risk-on', 'neutral', 'risk-off'] as const)
export type MarketRegime = (typeof MARKET_REGIMES)[number]

export interface SourceStamp {
  readonly sourceId: SourceId
  readonly fetchedAt: number
}

/** Whether a mark is an intraday read or a settled session close. */
const MARK_KINDS = Object.freeze(['live', 'close'] as const)
export type MarkKind = (typeof MARK_KINDS)[number]

/** What the intraday series has recorded today, up to `Quote.observedAt`. Never stored: the settled
 *  bar written at the close replaces it.
 *
 *  These are the series' own extremes, not the session's. A provider that publishes no bar for an
 *  opening auction — entrade serves none for HOSE's 09:00-09:15 ATO at any resolution — cannot
 *  report the open, and an auction print beyond these bounds is invisible here. `fromAt` is what
 *  makes that readable, so it travels with every reading rather than being assumed. */
export interface SessionSoFar {
  /** When the first bar these readings cover began. Absent from a provider that publishes the
   *  session's aggregates without a start; the quoting market fills it from its own calendar, which
   *  is the only owner of when a session opened. */
  readonly fromAt?: number
  readonly high: number
  readonly low: number
  /** Accumulated so far, absent where the provider's series carries no volume for the instrument. */
  readonly volume?: number
}

/** Both sides, where the market quotes a dealer board rather than a last trade - a VN gold shop's
 *  buy and sell, and the round-trip cost between them. A board states no last trade: its `price` is
 *  `sellPrice` again, so a surface prints one or the other and never both. */
export interface DealerBoard {
  readonly buyPrice: number
  readonly sellPrice: number
  readonly spreadPct?: number
}

export interface Quote {
  readonly instrument: InstrumentRef
  readonly price: number
  readonly changePct?: number
  readonly observedAt: number
  /** Present only on a live read from a provider that serves an intraday series. A price alone
   *  cannot say whether it sits at the session's high or its low. */
  readonly session?: SessionSoFar
  readonly board?: DealerBoard
}

/** Which reading a row carries, and when. A quoteBoard always asks for a live price and is answered with
 *  the last close whenever the session is shut, so the row has to say which one arrived: a live tick
 *  is named by its time, a close by the session it settled. */
export interface QuoteFreshness {
  readonly kind: 'live' | 'close'
  readonly day: TradingDay
  /** The instant the reading was taken. Every clock is rendered from it in the operator's own zone. */
  readonly observedAt: number
}

export interface Candle {
  readonly at: TradingDay
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
  /** Actual traded value in the instrument's currency, when the provider publishes one. */
  readonly turnover?: number
  /** Volume where the buyer crossed the spread, as the venue states it. Present only for a source
   *  that reports the aggressor rather than inferring it, which today is Binance alone. Absent, not
   *  zero, everywhere else: zero would read as nobody having bought. */
  readonly takerBuyVolume?: number
  readonly adjustment: BarAdjustment
}

export interface BarRecord extends SourceStamp {
  readonly instrument: InstrumentRef
  readonly candle: Candle
  readonly turnover?: number
}

export interface InstrumentRecord extends SourceStamp {
  readonly instrument: InstrumentRef
  readonly name: string
  readonly kind: InstrumentKind
  readonly status: InstrumentStatus
  readonly currency: CurrencyCode
  readonly exchange?: string
  /** Canonical form from `canonicalSector`, folded by the source so every consumer compares one key. */
  readonly sector?: string
  /** The narrowest index basket this name belongs to. Absent for a name in none, and for every
   *  kind but `equity` — an index or a fund is not a constituent of itself. */
  readonly indexTier?: VnIndexTier
  readonly listedOn?: TradingDay
  readonly expiresOn?: TradingDay
  readonly foreignOwnershipPct?: number
  readonly foreignOwnershipLimitPct?: number
}

export interface FundamentalSnapshot extends SourceStamp {
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  readonly currency: CurrencyCode
  /** The end of the fiscal period the statement-derived ratios describe. `asOf` is the close the
   *  priced ratios were computed against and moves every time the row is refetched, so it says how
   *  current the price is and nothing about how current the accounts are. Absent where the provider
   *  returned no statement-derived row. */
  readonly reportedOn?: TradingDay
  /** Return on average assets, not equity: leverage differs by thirty times across a market that
   *  lists banks beside manufacturers, and only the asset base is comparable between them. */
  readonly returnOnAssetsPct?: number
  readonly returnOnEquityPct?: number
  readonly grossMarginPct?: number
  readonly netMarginPct?: number
  readonly debtToEquity?: number
  readonly revenueGrowthYoyPct?: number
  readonly earningsGrowthYoyPct?: number
  readonly earningsPerShare?: number
  /** Priced by the source against the close named by `asOf`, not necessarily today's. This and
   *  `marketCap` share that close, so their quotient is price-free revenue — which is how the
   *  ranking recovers sales per share rather than reading a ratio priced a session ago. */
  readonly priceToSales?: number
  readonly bookValuePerShare?: number
  readonly marketCap?: number
  readonly sharesOutstanding?: number
  readonly freeFloatPct?: number
}

export interface FlowSnapshot extends SourceStamp {
  readonly instrument: InstrumentRef
  readonly at: TradingDay
  readonly currency: CurrencyCode
  readonly foreignBuyValue: number
  readonly foreignSellValue: number
  readonly foreignNetValue: number
  readonly proprietaryNetValue?: number
}

/** The proprietary desk's own net, from a provider that publishes that leg alone. Exists because
 *  the flows provider publishes the two desks on different cadences: this fills the leg its
 *  snapshot leaves unset, and carries no foreign figures because its provider states none. */
export interface ProprietaryFlow extends SourceStamp {
  readonly instrument: InstrumentRef
  readonly at: TradingDay
  readonly currency: CurrencyCode
  /** Absent when the provider reported the session but its figure did not hold together. The row
   *  survives so a reader can tell that desk from one that did not trade at all. */
  readonly netValue?: number
}

/** One settled session's matched volume, split by which side crossed the spread. `auctionVolume`
 *  is the ATO and ATC prints, which have no aggressor and belong to neither side - it is reported
 *  rather than folded in, because on an index review day it is a large share of the session and
 *  splitting it would manufacture pressure nobody applied. */
export interface DailyTradeSides extends SourceStamp {
  readonly instrument: InstrumentRef
  readonly at: TradingDay
  readonly buyVolume: number
  readonly sellVolume: number
  readonly auctionVolume: number
}

/** The provider's foreign-room counters, in shares: the aggregate foreigners may hold, and the
 *  slice still available to buy. Ratios against shares outstanding happen at the join site, where
 *  the stored fundamentals live. */
export interface ForeignRoom {
  readonly instrument: InstrumentRef
  readonly totalRoomShares: number
  readonly availableRoomShares: number
}

export interface MarketEvent {
  readonly at: TradingDay
  readonly kind: MarketEventKind
  readonly title: string
  readonly instrument?: InstrumentRef
  readonly detail?: string
  readonly providerEventId?: string
}

export interface IndexMembership {
  readonly instrument: InstrumentRef
  readonly tier: VnIndexTier
}

export interface MacroSnapshot extends SourceStamp {
  readonly region: Region
  readonly asOf: TradingDay
  readonly formulaVersion: string
  readonly values: Readonly<Partial<Record<MacroSeriesId, number>>>
  /** The day each series was actually observed on, parallel to `values`. The macro composite is
   *  stamped with `asOf` and the per-driver row carries its own date so a one-day-lag series reads
   *  honestly. Absent where the series had no usable observation. */
  readonly observationDates: Readonly<Partial<Record<MacroSeriesId, TradingDay>>>
  readonly regime?: MarketRegime
}

/** One name's row in the session the board is running right now, market-wide. Normalized but not
 *  judged: which kinds count and what a pinned price means are the market's rules, so the adapter
 *  parses and the market folds. */
export interface SessionQuote {
  readonly instrument: InstrumentRef
  readonly at: TradingDay
  readonly kind: InstrumentKind
  /** The exchange the name lists on, as the provider spells it. */
  readonly board: string
  readonly close: number
  readonly changePct: number
  /** Order-matched only, so a name that traded solely by negotiated block reads as untraded - the
   *  same rule the settled turnover follows. */
  readonly matchedVolume: number
}

export interface NewsItem {
  readonly title: string
  readonly url: string
  readonly publishedAt: number
  readonly sourceIds: readonly SourceId[]
  readonly summary?: string
}

export interface AnalystRecommendation extends SourceStamp {
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  readonly buyCount: number
  readonly holdCount: number
  readonly sellCount: number
  readonly targetPrice?: number
  readonly currency?: CurrencyCode
}

export interface SentimentSnapshot extends SourceStamp {
  readonly market: MarketRef
  readonly asOf: TradingDay
  readonly score: number
  readonly classification: string
}

interface OpenInterestRatio {
  readonly value: number
  readonly sessions: number
}

/** How much the contract count moved over the last `sessions` prints, as a signed fraction. Count,
 *  not notional, for the reason the ratio gives: notional is count × price and reports an expansion
 *  nobody opened whenever the price ran. */
interface OpenInterestChange {
  readonly value: number
  readonly sessions: number
}

export interface FundingSnapshot extends SourceStamp {
  readonly instrument: InstrumentRef
  /** The settled day the window ends on — what a stored row is keyed by and what a read asks for. */
  readonly asOf: TradingDay
  /** Newest print in the window the rate averages over. */
  readonly observedAt: number
  /** Percent charged per day, summed over `windowDays` of settlements and divided by that span.
   *  Never a per-settlement rate: Binance settles most perpetuals every four hours and some every
   *  hour, so the raw print is not comparable across contracts. */
  readonly fundingDailyPct: number
  /** The span the rate above was measured over, in days. It varies by contract because a fixed
   *  print count spans a different stretch at each settlement interval. */
  readonly windowDays: number
  /** Notional standing open, in the contract's quote currency. */
  readonly openInterestUsd?: number
  /** Latest contract count over the mean of the `sessions` readings ending on it, carried with that
   *  span so two providers averaging differently are never compared. Never the notional above it:
   *  notional is count × price, and reports an expansion nobody opened whenever the price ran. */
  readonly openInterestRatio?: OpenInterestRatio
  /** Absent where the history is shorter than the change window. */
  readonly openInterestChange?: OpenInterestChange
  /** Binance's global long/short account ratio, the latest print. */
  readonly longShortRatio?: number
}

/** Speculative positioning from a COT-style report. The report's week is the position date; the
 *  percentile ranks the latest net against its own trailing year. */
export interface PositioningSnapshot extends SourceStamp {
  readonly market: MarketRef
  /** The report's Tuesday, the day the positions were held. */
  readonly week: TradingDay
  readonly netLongContracts: number
  readonly weekChangeContracts?: number
  readonly yearPercentile?: number
}

/** Spot-ETF net flows for a market. `day` is the latest settled session the issuer disclosed — flows
 *  are a T+1 fact; `windowNetFlowUsd` sums the last `windowSessions` disclosed days. */
export interface EtfFlowSnapshot extends SourceStamp {
  readonly market: MarketRef
  /** The last settled session the issuer disclosed — flows are a T+1 fact. */
  readonly day: TradingDay
  readonly netFlowUsd: number
  readonly windowSessions: number
  readonly windowNetFlowUsd: number
}

/** The series the screen publishes percentiles for, plus the cross-market ones an overview rolls up.
 *  Each id is a frozen key a source or overview may stamp; a new percentile series widens this union. */
export type PercentileId = 'advance-ratio' | 'above-ma20' | 'above-ma50' | 'premium' | 'oi-ratio'

/** One series' rank within its own trailing window, as a 0-1 value. The optional id lets a table
 *  name the percentile it carries; absent when the entry is keyed by its parent record instead. */
export interface PercentileEntry {
  readonly value: number
  readonly id?: PercentileId
}

export interface MarketCapRecord extends SourceStamp {
  readonly instrument: InstrumentRef
  /** The coin as the provider lists it. A ticker identifies it; only the name spells it. */
  readonly name: string
  readonly asOf: TradingDay
  readonly marketCapUsd: number
  /** Traded value across every venue the provider aggregates, in the same scope as `marketCapUsd`.
   *  Bars carry one venue's volume, so deriving this from them measures a fraction of the market
   *  against the whole of it. */
  readonly totalVolumeUsd: number
  readonly rank: number
  readonly priceUsd: number
  readonly changePct?: number
  /** One-week change, percent-valued: the window every board provider publishes, and the one the
   *  crypto sleeve's alt-breadth driver counts rising names over. */
  readonly change7dPct?: number
  /** When the provider last observed the price, not when we read it: a sweep answers a board of
   *  rows whose readings were taken at their own moments. */
  readonly observedAt: number
}

export interface FxQuote extends SourceStamp {
  readonly fromCurrency: CurrencyCode
  readonly toCurrency: CurrencyCode
  readonly rate: number
  readonly asOf: TradingDay
}

/** One session's close for a currency pair. The history behind `FxQuote`: a confirmer measuring
 *  depreciation needs the rate as it stood a window back, which a spot quote cannot answer. */
export interface FxRatePoint {
  readonly day: TradingDay
  readonly rate: number
}

export interface GoldBoardRow {
  readonly form: VnGoldForm
  readonly vendor: string
  readonly buyPricePerLuong: number
  readonly sellPricePerLuong: number
}

/** One board row on one past session — the live row plus the day it was quoted, so a dated board
 *  assembles from these with no conversion. Oldest day first wherever a run of these travels,
 *  like `bars`. */
export interface GoldBoardPoint extends GoldBoardRow {
  readonly day: TradingDay
}

export interface GoldBoard extends SourceStamp {
  readonly asOf: TradingDay
  readonly observedAt: number
  readonly rows: readonly GoldBoardRow[]
}

/** The macro ceiling on deployable capital. `regime` is absent when the market publishes no macro
 *  read at all — ungoverned, which is not the same claim as risk-on. */
export interface RegimeScale {
  readonly regime?: MarketRegime
  /** Whether `regime` is a reading rather than the defensive default a failed or thinly covered
   *  macro answers with. A ceiling may rest on that default; selling a holding may not. Required so
   *  a new construction site has to state which it holds. */
  readonly rated: boolean
  readonly scale: number
  readonly caveats: readonly Caveat[]
}
