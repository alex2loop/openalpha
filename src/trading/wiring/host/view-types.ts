import type { BriefText } from '@/trading/features/brief/surface'
import type { BriefSnapshot } from '@/trading/features/brief/types'
import type { ScreenCard } from '@/trading/features/market-data/render/screen'
import type { BoardFact } from '@/trading/features/market-data/render/screen-facts'
import type { MarketDescription, ScreenView } from '@/trading/features/market-data/types'
import type { VenueReconciliation } from '@/trading/features/portfolio/folds/reconcile'
import type { ReconcileSentences } from '@/trading/features/portfolio/render/reconcile'
import type { TrackRecordReflection } from '@/trading/features/suggestion/suggestion'
import type { AgentRecordView } from '@/trading/features/suggestion/track-record/agent-record'
import type { ModelRecord } from '@/trading/features/suggestion/track-record/model-record'
import type { ReflectText } from '@/trading/features/suggestion/track-record/surface'
import type { FactorMetricId } from '@/trading/kernel/factor-metric'
import type { InstrumentKind, Region } from '@/trading/kernel/instrument'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { StopCover, StopDistance } from '@/trading/kernel/operator/alert'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDay } from '@/trading/markets/calendar'
import type { QuoteConvention } from '@/trading/render/money'

export interface ReconcileView {
  readonly venues: readonly VenueReconciliation[]
  readonly text: ReconcileSentences
}

/** An agent's record with the lines a terminal prints for it, in the requested language. */
export interface AgentRecordSummary extends AgentRecordView {
  readonly lines: readonly string[]
}

/** One plain value a market states beside a name's factors: what it is, its value in the unit the
 *  market publishes it in, and the words the CLI's board rows write for it. */
interface ScreenReading {
  readonly id: FactorMetricId
  readonly sessions?: number
  readonly value: number
  readonly text: string
}

/** What a name reads on a board, grouped and each reading once as the CLI's board lists them, and
 *  the factors that had nothing to read for it, in the operator's language. */
interface ScreenNameFacts {
  readonly facts: readonly BoardFact[]
  readonly missing: readonly string[]
}

/** A screen read with the CLI's own lines for it. A `board` view also names the factors it reads, in
 *  the operator's language, keyed by factor id, and writes what each name's factors read, keyed by
 *  ticker and then factor id, and the plain values its market states for each name, keyed by ticker.
 *  `kinds` names, in the operator's language, the kinds a market with more than one can be narrowed
 *  to. Every form names the facts of each name, keyed by ticker. */
export interface ScreenAnswer {
  readonly view: ScreenView
  readonly card: ScreenCard
  readonly factorLabels?: Readonly<Record<string, string>>
  readonly factorReadings?: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly nameReadings?: Readonly<Record<string, readonly ScreenReading[]>>
  readonly nameFacts?: Readonly<Record<string, ScreenNameFacts>>
  readonly kinds?: readonly { readonly kind: InstrumentKind; readonly label: string }[]
  /** The market's first load is still running: the board is what is stored so far. */
  readonly isLoading?: true
}

/** A holding's planned stop, and who stands behind it at the exchange. `cover` is absent where
 *  nothing could rest: no exchange account, a custodian with no client, or a venue that did not
 *  answer. */
export interface HeldStopView extends StopDistance {
  readonly cover?: StopCover
}

/** One registered market as an app lays it out: its facts, how it prints a price, and its names
 *  in the operator's language. */
export interface MarketView extends MarketDescription, QuoteConvention {
  readonly label: string
  readonly segmentLabel: string
  readonly regionLabel: string
  /** Its day at the instant asked; absent with `session`. */
  readonly day?: MarketDay
}

/** Every registered market, with the operator's home region: its owner is the default market. */
export interface TradingMarketsView {
  readonly homeRegion: Region
  readonly markets: readonly MarketView[]
}

/** Whether the operator ever saved a profile, and whether the ledger holds a single row. */
export interface TradingSetupView {
  readonly profileSaved: boolean
  readonly bookEmpty: boolean
}

export interface TradingMacroView {
  readonly region: Region
  readonly result: SourceResult<MacroRiskView>
  /** The CLI's lean sentence; absent with the macro read. */
  readonly lean?: string
  /** Each driver's name in the operator's language, keyed by driver id. */
  readonly labels: Readonly<Record<string, string>>
}

/** The snapshot stores no region - one operator has one - so the resolved region travels beside
 *  it. */
export interface TradingBriefView {
  readonly region: Region
  readonly snapshot: BriefSnapshot | null
  /** The brief's lines as the CLI prints them; null with the snapshot. */
  readonly text: BriefText | null
}

export interface TradingTrackRecordView {
  readonly reflection: TrackRecordReflection
  readonly text: ReflectText
  readonly byModel: readonly ModelRecord[]
}
