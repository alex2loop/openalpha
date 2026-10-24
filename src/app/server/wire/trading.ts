// The /v1 trading contract. Field-for-field JSON projections of the runtime's domain types:
// branded ids become strings, every instant becomes epoch milliseconds, every trading day stays
// `YYYY-MM-DD`, and authored prose carries the locale it was written in. No class, Date, provider
// payload, credential, SQL row, or `unknown` field crosses this boundary.
// Additive-only within v1. camelCase keys, no snake_case on the wire, no field renames.

import type { ByModelWire } from '@/app/server/wire/track-record'
import type {
  AssetClass,
  BriefSectionKind,
  CaveatSeverity,
  ConvictionBand,
  InstrumentKind,
  InvestmentGoal,
  InvestmentHorizon,
  MarketEventKind,
  RiskLevel,
  SourceFreshness,
} from '@/app/server/wire/vocab'
import type { Locale } from '@/core/types/locale'

/** `info` is a by-design note on how a figure was made; `warn` is a degradation. `text` is the CLI's
 *  sentence in the operator's language, so a client shows it as it is. */
export interface TradingWireCaveat {
  readonly code: string
  readonly data?: Readonly<Record<string, string | number>>
  readonly severity: CaveatSeverity
  readonly text: string
}

/** Freshness lives on each row, never as one aggregate: a response assembled from four sources has
 *  no single answer, and "freshness: stale" would tell a client nothing about which number to
 *  distrust. */
export interface TradingWireProvenance {
  readonly sourceId: string
  readonly observedAt?: number
  readonly fetchedAt: number
  readonly freshness: SourceFreshness
}

export interface TradingQuoteWire {
  readonly ticker: string
  readonly label: string
  readonly region: string
  readonly currency: string
  readonly last: number
  readonly changePct?: number
  /** The session `last` closed in, once it has settled; absent on a live reading. */
  readonly closedOn?: string
  /** When a price too old to be live was read, in a session still trading. */
  readonly staleAt?: number
  readonly provenance: readonly TradingWireProvenance[]
  readonly caveats: readonly TradingWireCaveat[]
  readonly kind: Exclude<InstrumentKind, 'fx'>
  readonly market: string
  readonly assetClass: AssetClass
}

export interface TradingQuotesResponse {
  readonly quotes: readonly TradingQuoteWire[]
  readonly caveats: readonly TradingWireCaveat[]
}

export interface TradingCandleWire {
  readonly at: string
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
}

export interface TradingOhlcvResponse {
  readonly market: string
  readonly ticker: string
  readonly bars: readonly TradingCandleWire[]
  readonly provenance: readonly TradingWireProvenance[]
  readonly caveats: readonly TradingWireCaveat[]
}

export interface MarketEventWire {
  readonly at: string
  readonly kind: MarketEventKind
  /** The source's own title, in the language it publishes in. */
  readonly title: string
  readonly detail?: string
}

/** One name's corporate events over a day range: ex-dates, meetings, splits, listings. */
export interface TradingEventsResponse {
  readonly market: string
  readonly ticker: string
  readonly events: readonly MarketEventWire[]
  readonly provenance: readonly TradingWireProvenance[]
  readonly caveats: readonly TradingWireCaveat[]
}

export interface TradingNewsItemWire {
  readonly title: string
  readonly url: string
  readonly sourceIds: readonly string[]
  readonly publishedAt: number
  readonly summary?: string
}

export interface TradingNewsResponse {
  readonly region: string
  readonly items: readonly TradingNewsItemWire[]
  readonly provenance: readonly TradingWireProvenance[]
  readonly caveats: readonly TradingWireCaveat[]
}

export interface InstrumentRefWire {
  readonly market: string
  readonly ticker: string
}

interface RiskCapWire {
  readonly maximumPositionPctNav: number
  readonly maximumSegmentPctNav: number
}

export interface TradingProfileResponse {
  readonly preferredLocale: Locale
  readonly baseCurrency: string
  readonly riskLevel: RiskLevel
  readonly riskCapacity: RiskLevel
  readonly riskWillingness: RiskLevel
  readonly horizons: Readonly<Record<string, InvestmentHorizon>>
  readonly goal: InvestmentGoal
  readonly watchlist: readonly InstrumentRefWire[]
  readonly exclusions: readonly InstrumentRefWire[]
  readonly segmentTargets: Readonly<Record<string, number>>
  readonly caps: Readonly<Record<string, RiskCapWire>>
  readonly maximumSectorPctNav: number
  readonly reservePctNav: number
  readonly regimeScale: number
  readonly riskPerTradePctNav: number
}

export interface AbsolutePositionWire {
  readonly instrument: InstrumentRefWire
  readonly quantity: number
  /** Smaller than the smallest order any venue holding it accepts: residue a full exit left. The
   *  CLI's `/portfolio` lists no such row and only counts them; the value stays in the NAV. */
  readonly belowMinimumSize: boolean
  readonly settledQuantity: number
  /** The buy price in the market's own currency, fees included (`costBasisNative / quantity`);
   *  absent at quantity 0. */
  readonly unitCostNative?: number
  /** The day of the first buy since the position last opened from flat; absent at quantity 0. */
  readonly heldSince?: string
  readonly marketValueBase?: number
  /** Fees held out, so `marketValueBase - investedBase` is exactly the `unrealizedPnlBase`
   *  beside it. */
  readonly investedBase: number
  readonly unrealizedPnlBase?: number
  readonly weightPctNav?: number
  /** Projected from the singular `ValuedPosition.caveat` as a zero-or-one-element array. */
  readonly caveats: readonly TradingWireCaveat[]
}

interface NavPointWire {
  readonly day: string
  readonly nav: number
  readonly index: number
}

export interface NavBenchmarkWire {
  readonly legs: readonly {
    readonly segment: string
    readonly weight: number
    readonly instrument?: InstrumentRefWire
  }[]
  readonly points: readonly { readonly day: string; readonly index: number }[]
  readonly periodReturn: number
}

export interface TradingNavResponse {
  readonly window: string
  readonly baseCurrency: string
  readonly firstDay?: string
  readonly recordedCount: number
  readonly points: readonly NavPointWire[]
  readonly periodReturn?: number
  readonly maximumDrawdown?: number
  readonly currentDrawdown?: number
  readonly benchmark?: NavBenchmarkWire
  readonly benchmarkGap?: string
}

export interface TradingPortfolioResponse {
  readonly asOf: string
  readonly baseCurrency: string
  readonly navBase?: number
  readonly cashBase: number
  readonly availableCashBase: number
  readonly positions: readonly AbsolutePositionWire[]
  readonly caveats: readonly TradingWireCaveat[]
}

interface CalculationVersionWire {
  readonly name: string
  readonly version: string
}

interface SuggestionOutcomeWire {
  readonly status: 'target' | 'stop' | 'expired'
  readonly resolvedAt: number
  readonly exitDay: string
  readonly returnPct: number
  readonly benchmarkReturnPct?: number
}

interface SuggestionWireBase {
  readonly id: string
  readonly instrument: InstrumentRefWire
  readonly at: string
  readonly authoredLocale: Locale
  readonly conviction: ConvictionBand
  readonly strategyId: string
  readonly strategyVersion: string
  /** `default` for the call that drives the operator's book; any other key is an agent's second
   *  opinion under its own `[focus]`. */
  readonly focusKey: string
  readonly calculationVersions: readonly CalculationVersionWire[]
  readonly createdAt: number
  readonly provenance: readonly TradingWireProvenance[]
  readonly caveats: readonly TradingWireCaveat[]
  /** The stop the daily trail raised this plan to; absent until it rises. */
  readonly trailingStop?: number
  /** A held name's standing stop this run raised, from this level. */
  readonly raisedStopFrom?: number
  /** The models that argued the call, sorted. Absent on a call stored before they were kept. */
  readonly models?: readonly string[]
}

/** A discriminated union, not an optional-field bag: a hold has no entry, stop, target, or outcome,
 *  and making them optional on one interface would let a client render `entry: undefined` as a
 *  number. `outcome?: never` on the hold arm says a hold is never resolved, because it was never
 *  actionable. */
export type SuggestionWire =
  | (SuggestionWireBase & {
      readonly action: 'buy' | 'reduce'
      readonly thesis: string
      readonly entry: number
      readonly stop: number
      readonly target: number
      readonly riskReward: number
      readonly sizePctNav?: number
      readonly outcome?: SuggestionOutcomeWire
    })
  | (SuggestionWireBase & {
      readonly action: 'hold'
      readonly thesis?: string
      readonly entry?: number
      readonly stop?: number
      readonly target?: number
      readonly riskReward?: number
      readonly holdReasonCodes: readonly string[]
      /** True when the row records a run that failed rather than a decision: the daemon re-runs it. */
      readonly undecided?: true
      readonly outcome?: never
    })

export interface TradingSuggestionsResponse {
  readonly suggestions: readonly SuggestionWire[]
  readonly nextCursor?: string
}

interface TrackRecordVersionWire {
  readonly strategyVersion: string
  readonly calculationVersions: readonly CalculationVersionWire[]
  readonly resolvedCount: number
}

interface TrackRecordCalibrationWire {
  readonly convictionBand: ConvictionBand
  readonly resolvedCount: number
  readonly winRate?: number
}

interface TrackRecordSummaryWire {
  readonly resolvedCount: number
  readonly winRate?: number
  readonly meanReturnPct?: number
  readonly medianReturnPct?: number
  readonly benchmarkComparedCount: number
  readonly benchmarkBeatCount: number
  readonly benchmarkMeanReturnPct?: number
  readonly beatsBenchmarkMajority?: boolean
  readonly versions: readonly TrackRecordVersionWire[]
  readonly calibration: readonly TrackRecordCalibrationWire[]
  /** One row per focus the record was read across; the operator's own is `default`. */
  readonly focuses: readonly {
    readonly focusKey: string
    readonly resolvedCount: number
    readonly winCount: number
    readonly targetCount: number
    readonly winRate?: number
  }[]
  /** The calls each model argued alone; a call several models argued is in none. */
  readonly byModel: readonly ByModelWire[]
  readonly caveats: readonly TradingWireCaveat[]
}

/** How the resolved calls were used. Both means appear only once each group reaches the reporting
 *  minimum. Fractions like the summary's returns; a positive `shortfallPct` is a worse fill than
 *  the suggested entry. */
interface ActedSummaryWire {
  readonly resolvedCount: number
  readonly actedCount: number
  readonly actedMeanReturnPct?: number
  readonly passedMeanReturnPct?: number
  readonly shortfallPct?: number
}

/** `/reflect`'s own lines. The numbers beside them are for charts and sorting, never for rewording. */
interface ReflectTextWire {
  /** The header, the coverage, the overall figures and the small-sample warning. */
  readonly summary: readonly string[]
  readonly byConviction: readonly string[]
  readonly acted: readonly string[]
  readonly closed: readonly { readonly suggestionId: string; readonly line: string }[]
}

export interface TradingTrackRecordResponse {
  readonly summary: TrackRecordSummaryWire
  readonly text: ReflectTextWire
  readonly recent: readonly SuggestionWire[]
  /** Absent while no call has resolved. */
  readonly acted?: ActedSummaryWire
}

/** `unavailable` and `omitted-by-policy` stay distinct: "we could not get this" and "you turned
 *  this off" look identical if both are a missing section, and only one is worth telling the user
 *  about. */
/** A name that joined or left the market's ranked board since the session before. */
export interface ScreenDeltaRowWire {
  readonly ticker: string
  readonly direction: 'entered' | 'left'
}

/** The market a section belongs to and the session its numbers describe; both absent on a section
 *  about the operator's own book. */
interface BriefSectionScope {
  readonly market?: string
  readonly asOf?: string
}

export type BriefSectionWire = BriefSectionScope &
  (
    | {
        readonly kind: 'screen-delta'
        readonly status: 'ready'
        readonly rows: readonly ScreenDeltaRowWire[]
        readonly provenance: readonly TradingWireProvenance[]
        readonly caveats: readonly TradingWireCaveat[]
      }
    | {
        readonly kind: Exclude<BriefSectionKind, 'screen-delta'>
        readonly status: 'ready'
        readonly rows: readonly Readonly<Record<string, string | number>>[]
        readonly provenance: readonly TradingWireProvenance[]
        readonly caveats: readonly TradingWireCaveat[]
      }
    | {
        readonly kind: BriefSectionKind
        readonly status: 'unavailable' | 'omitted-by-policy'
        readonly caveats: readonly TradingWireCaveat[]
      }
  )

export interface BriefSnapshotWire {
  readonly id: string
  readonly region: string
  readonly day: string
  readonly authoredLocale: Locale
  readonly createdAt: number
  readonly sections: readonly BriefSectionWire[]
  readonly caveats: readonly TradingWireCaveat[]
}

/** The brief as the CLI prints it, without its icons and indents. */
export interface BriefTextWire {
  readonly title: string
  /** The answer: the session sentence and the figures it rests on. */
  readonly verdict: readonly string[]
  /** The review of earlier stories and today's story; empty when the brief tells none. */
  readonly story: readonly string[]
  /** Ready and unavailable sections in the brief's order; one turned off by policy is not here, and
   *  neither is the cost or the macro reference the verdict already states. */
  readonly sections: readonly {
    /** Unique in the brief: a market's kind repeats once per market. */
    readonly id: string
    readonly kind: string
    /** The market's name, on a section that belongs to one. */
    readonly market?: string
    readonly status: 'ready' | 'unavailable'
    readonly heading: string
    readonly lines: readonly string[]
  }[]
  /** Every caveat the brief carries, stated once, as the CLI words them. */
  readonly caveats: readonly string[]
}

export interface TradingBriefResponse {
  readonly snapshot: BriefSnapshotWire | null
  readonly text: BriefTextWire | null
}

/** The decision card for one stored suggestion, every line in the operator's language. */
export interface SuggestionCardWire {
  readonly verdict: string
  /** What the run read and when: evidence day, earlier calls, stamp, quote, scale, holding. */
  readonly facts: readonly string[]
  readonly reasons: readonly string[]
  readonly levels: readonly string[]
  readonly notes: readonly string[]
  readonly calibration?: string
  /** The rest of `/suggest` after the plan, one block each: factors, debate, thesis, what would
   *  break it, sources and caveats. */
  readonly details: readonly (readonly string[])[]
  readonly disclaimer: string
}

/** GET /v1/suggestions/:id/card. `card` is null for an id the store does not hold. */
export interface SuggestionCardResponse {
  readonly card: SuggestionCardWire | null
}
