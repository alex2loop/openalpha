import type { Caveat } from '@/trading/kernel/caveat'
import type {
  CurrencyCode,
  MarketRef,
  PriceDisplay,
  SessionPhase,
  Ticker,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { PreviousClose } from '@/trading/kernel/market/market-capability'
import type { QuoteFreshness, SessionSoFar } from '@/trading/kernel/market/market-data'
import type { MarketIntradayBreadth } from '@/trading/kernel/market/market-overview'
import type {
  BriefSectionResult,
  BriefSectionRow,
  OverviewSectionKind,
} from '@/trading/kernel/operator/brief-section'

/** One line each in the settled block, in render order. The locale manifest derives a label key per
 *  member, so a field cannot exist without both translations. */
export const INTRADAY_FIELDS = Object.freeze([
  'breadth',
  'turnover',
  'foreign',
  'proprietary',
  'leaders',
  'movers-session',
  'movers-24h',
  'range',
  'boards',
] as const)

export type IntradayField = (typeof INTRADAY_FIELDS)[number]

/** What a market the operator holds contributes beside the one this report covers: the standing
 *  readings that no price row states and that keep their meaning while a session runs. */
export const INTRADAY_CONTEXT_KINDS = Object.freeze([
  'sentiment',
  'derivatives',
  'premium',
] as const satisfies readonly OverviewSectionKind[])

export interface IntradayRow {
  readonly ticker: Ticker
  /** Its own market, not the report's: a book spans markets that keep different clocks and
   *  currencies, and the rows have to say which one each belongs to. */
  readonly market: MarketRef
  readonly price?: number
  readonly changePct?: number
  /** Absent together with `price`: a row whose quote never came back has no currency to report. */
  readonly currency?: CurrencyCode
  readonly observed?: QuoteFreshness
  /** The settled close `price` moved from, so a row states both readings rather than one. */
  readonly previousClose?: PreviousClose
  /** Whether the session has printed a trade. Absent where the provider serves no volume, and the
   *  row then reports its change as given rather than guessing. */
  readonly traded?: boolean
  /** The high and low the reading's own session has recorded so far. Absent from a provider serving
   *  no intraday series. */
  readonly session?: SessionSoFar
  /** The session opened at least a gap above the settled close and has since traded back through
   *  it. Present only while the session is live; a settled row cannot fail a gap. */
  readonly gapFailed?: true
  /** How this row's own market quotes a price. Stamped at build time because the report is also
   *  delivered unattended, where the renderer has no registry to ask. */
  readonly display?: PriceDisplay
}

/** One settled field and the rows it prints, first row on the label line. A field the market did not
 *  publish is absent here and renders in place as "not reported", so the block's shape never changes
 *  with the data. */
export interface IntradaySettledField {
  readonly field: IntradayField
  readonly rows: readonly BriefSectionRow[]
  /** Fills the field label's placeholders, the way a brief section's `titleParams` fill its title:
   *  the same label over a different window is a different number. Absent where the field was not
   *  measured, which is what drops the window rather than printing one nothing stands behind. */
  readonly labelParams?: Readonly<Record<string, string | number>>
}

export interface IntradaySettled {
  readonly day: TradingDay
  /** What every money figure in the block is denominated in. */
  readonly currency: CurrencyCode
  readonly fields: readonly IntradaySettledField[]
}

/** A held market other than the report's own, and the context sections it published. Its glyph
 *  rides along because the report is also delivered unattended, where the renderer has no market
 *  registry to ask. */
export interface IntradayMarketContext {
  readonly market: MarketRef
  readonly icon: string
  readonly sections: readonly BriefSectionResult[]
}

export interface IntradayReport {
  readonly market: MarketRef
  readonly phase: SessionPhase
  readonly firedAt: number
  /** Every index the market publishes, in the order its overview returns them. A list, not a
   *  guessed primary: nothing in `MarketDataOverview` marks one row as the market's headline. */
  readonly indexes: readonly IntradayRow[]
  readonly positions: readonly IntradayRow[]
  readonly positionsOverflow: number
  readonly watchlist: readonly IntradayRow[]
  readonly watchlistOverflow: number
  /** The session running now, counted from the live board. Absent outside a session, and absent
   *  once `settled` describes the same day - the settled count is then the better one. */
  readonly session?: MarketIntradayBreadth
  /** Absent only when the market has published no settled session at all. */
  readonly settled?: IntradaySettled
  /** The other markets this book touches, each with what it publishes beyond a price. */
  readonly contexts: readonly IntradayMarketContext[]
  /** True while the settled block describes a day earlier than today - which is the case all
   *  morning, and stays the case after the close until the refresh stores today's rows. */
  readonly sessionForming: boolean
  readonly caveats: readonly Caveat[]
}
