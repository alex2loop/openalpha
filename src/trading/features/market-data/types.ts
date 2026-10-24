import type { SessionHours } from '@/trading/kernel/config'
import type {
  BoardLotPolicy,
  CurrencyCode,
  InstrumentKind,
  InstrumentMatch,
  InstrumentRef,
  InstrumentSearchRequest,
  MarketRef,
  PortfolioSegment,
  Region,
  ScreenableKinds,
  Ticker,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { AccountsHistory } from '@/trading/kernel/market/annual-accounts'
import type {
  FuturesBasis,
  PreviousCloseOption,
  QuoteBoard,
  QuoteBoardRequest,
  QuoteView,
  ScreenCandidate,
  ScreenResult,
  SectorStrengthResult,
} from '@/trading/kernel/market/market-capability'
import type {
  AnalystRecommendation,
  Candle,
  FlowSnapshot,
  FundingSnapshot,
  MarketEvent,
  NewsItem,
  SentimentSnapshot,
} from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type { MarketNews, SourceResult, SourceSummary } from '@/trading/kernel/source/source-result'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'
import type { QuoteConvention } from '@/trading/render/money'

/** The requests above are the *resolved* form a market capability consumes. The requests below are
 *  the surface-facing form: the ticker may not name its market yet and the day may still be an
 *  instant, because `MarketDataService` is the only holder of the market registry and calendar that
 *  resolve either. A tool, command, or route therefore never imports a registry to build one. */
export interface MarketDataRequest {
  readonly now: number
  readonly signal: AbortSignal
  /** Present when a surface is waiting on this read; the evidence warm it triggers reports its
   *  stages through it. */
  readonly progress?: StageReporter
}

/** A read that answers once per market. Absent `markets` is every registered one. */
export interface MarketDataPerMarketRequest extends MarketDataRequest {
  readonly markets?: readonly MarketRef[]
}

export interface MarketDataInstrumentRequest extends MarketDataRequest {
  readonly ticker: Ticker
  readonly market?: MarketRef
}

export interface MarketDataQuoteRequest extends MarketDataInstrumentRequest, PreviousCloseOption {}

export interface MarketDataDayRangeRequest extends MarketDataRequest {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

export interface MarketDataBarsRequest extends MarketDataDayRangeRequest {
  readonly ticker: Ticker
  readonly market?: MarketRef
}

/** One registered market as a surface lays it out. */
export interface MarketDescription {
  readonly market: MarketRef
  readonly region: Region
  /** Whether its calendar is its region's trading day and its macro read the region's composite. */
  readonly ownsRegion: boolean
  readonly segment: PortfolioSegment
  readonly currency: CurrencyCode
  readonly icon: string
  /** The index its suggestions are measured against; absent where it keeps none. */
  readonly benchmark?: InstrumentRef
  /** When it trades; absent for a market that never closes. */
  readonly session?: SessionHours
  /** Whether it answers a screen board, a morning brief, and corporate events. */
  readonly hasBoard: boolean
  readonly hasBrief: boolean
  readonly hasEvents: boolean
}

export interface MarketDataEventsRequest extends MarketDataDayRangeRequest {
  readonly ticker: Ticker
  readonly market?: MarketRef
}

/** Foreign and proprietary flow is published per market session, so the day range selects the rows
 *  and an optional ticker only narrows them. */
export interface MarketDataFlowsRequest extends MarketDataDayRangeRequest {
  readonly ticker?: Ticker
  readonly market?: MarketRef
}

export interface MarketDataMarketRequest extends MarketDataRequest {
  readonly market: MarketRef
}

export interface MarketDataRegionRequest extends MarketDataRequest {
  readonly region: Region
}

export interface MarketDataCuratedNewsRequest extends MarketDataRegionRequest {
  readonly limit: number
}

export interface MarketDataHeadlinesRequest extends MarketDataPerMarketRequest {
  readonly limit: number
}

export interface MarketDataNewsRequest extends MarketDataRequest {
  readonly ticker?: Ticker
  readonly market?: MarketRef
  readonly region?: Region
  readonly limit: number
}

export interface MarketDataScreenRequest extends MarketDataMarketRequest {
  readonly limit: number
  readonly instrumentKind?: InstrumentKind
  /** Narrows the board to these sector slugs; a market that files none ignores it. */
  readonly sectors?: readonly string[]
}

/** The operator's exclusion list, injected rather than imported: the board marks an excluded name
 *  without this module reaching the feature that owns one. */
export interface ExclusionReader {
  exclusions(signal: AbortSignal): Promise<readonly InstrumentRef[]>
}

/** A ranked candidate plus what the operator's own policy says about it. The mark is never set by a
 *  market - a market ranks instruments and knows nothing about who is reading. */
export interface ScreenedCandidate extends ScreenCandidate {
  readonly excluded?: true
  /** Off the exchange's margin list on the board's day. A broker will not lend against it, and the
   *  list is where every name under exchange supervision lands. */
  readonly marginIneligible?: true
}

export interface ScreenView extends Omit<ScreenResult, 'candidates'> {
  readonly candidates: readonly ScreenedCandidate[]
}

export interface MarketDataService {
  listSources(): readonly SourceSummary[]
  /** The registered regions. A region arriving from a wire payload or a command line is a lookup
   *  key that must be checked before use, and this service is the only holder of the registry that
   *  can answer — no surface builds its own. */
  regions(): readonly Region[]
  /** The registered market refs, for the same reason: a surface that names the valid set in its
   *  input schema stops a caller guessing, and only this service can enumerate it. */
  markets(): readonly MarketRef[]
  /** How a market prints a price - what it quotes in, the measure it quotes per, and its board
   *  convention where it has one. A renderer cannot reach the registry, and only the registry
   *  knows any of the three. */
  quoteConvention(market: MarketRef): QuoteConvention | undefined
  /** What a surface needs to know about each market to lay itself out: where it trades, whether it
   *  speaks for its region, its index, and which reads it answers. Registration order. */
  describeMarkets(): readonly MarketDescription[]
  /** One instrument's convention, where the market's is wrong for it: an index is a level, and
   *  scaling it by the board would print 1,850 as 1.85. */
  instrumentQuoteConvention(
    options: Pick<MarketDataInstrumentRequest, 'ticker' | 'market' | 'signal'>
  ): Promise<QuoteConvention | undefined>
  /** The reward-to-risk a market requires of a setup before it is worth taking, where it states
   *  one. Every surface that names the price a plan stops paying it reads the floor from here, so
   *  no renderer fixes a multiple of its own. */
  minimumRiskReward(market: MarketRef): number | undefined
  /** The smallest quantity a market's venues accept, for a surface that splits a size into orders:
   *  a share of a position is only advice the operator can follow if it lands on a whole lot. */
  boardLot(market: MarketRef): BoardLotPolicy | undefined
  /** Whether a market raises a held name's stop as the price runs, so a plan never promises a
   *  trail the market does not keep. */
  trailsStop(market: MarketRef): boolean
  /** Which markets hold more than one instrument kind, and which kinds — the only markets a screen
   *  can be narrowed on, and one more registered set no surface may name for itself. */
  screenableKinds(): ScreenableKinds
  quoteBoard(options: QuoteBoardRequest): Promise<QuoteBoard>
  quote(options: MarketDataQuoteRequest): Promise<SourceResult<QuoteView>>
  bars(options: MarketDataBarsRequest): Promise<SourceResult<readonly Candle[]>>
  overview(options: MarketDataPerMarketRequest): Promise<readonly MarketDataOverview[]>
  events(options: MarketDataEventsRequest): Promise<SourceResult<readonly MarketEvent[]>>
  news(options: MarketDataNewsRequest): Promise<SourceResult<readonly NewsItem[]>>
  newsPerMarket(options: MarketDataHeadlinesRequest): Promise<readonly MarketNews[]>
  macroNews(options: MarketDataHeadlinesRequest): Promise<SourceResult<readonly NewsItem[]>>
  economyNews(options: MarketDataHeadlinesRequest): Promise<SourceResult<readonly NewsItem[]>>
  curatedNews(options: MarketDataCuratedNewsRequest): Promise<SourceResult<readonly NewsItem[]>>
  screen(options: MarketDataScreenRequest): Promise<ScreenView>
  /** Ticker starts and company names from the markets that keep a catalog, plus an exact symbol
   *  from any market. An exact crypto symbol asks the provider, so a caller debounces typing. */
  searchInstruments(options: InstrumentSearchRequest): Promise<readonly InstrumentMatch[]>
  sectors(options: MarketDataMarketRequest): Promise<SectorStrengthResult>
  sentiment(options: MarketDataMarketRequest): Promise<SourceResult<SentimentSnapshot>>
  funding(options: MarketDataInstrumentRequest): Promise<SourceResult<FundingSnapshot>>
  recommendations(
    options: MarketDataInstrumentRequest
  ): Promise<SourceResult<readonly AnalystRecommendation[]>>
  /** A listed company's final annual accounts read off the board pass, for the chat agent and the
   *  debate: per-year figures, the trend and the flags. */
  accounts(options: MarketDataInstrumentRequest): Promise<SourceResult<AccountsHistory>>
  flows(options: MarketDataFlowsRequest): Promise<SourceResult<readonly FlowSnapshot[]>>
  macroRisk(options: MarketDataRegionRequest): Promise<SourceResult<MacroRiskView>>
  /** VN30 futures basis routes to the one market that implements it, so the range is the whole
   *  selector. */
  basis(options: MarketDataDayRangeRequest): Promise<SourceResult<FuturesBasis>>
}
