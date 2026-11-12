import type { BrandTag } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { SuggestionCitation } from '@/trading/features/suggestion/citation'
import type {
  AnalysisCase,
  ClaimVerification,
  StoredClaim,
} from '@/trading/features/suggestion/debate/types'
import type { SuggestionRequest, SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type {
  CurrencyCode,
  InstrumentRef,
  PriceDisplay,
  QuoteUnit,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { MacroUnit } from '@/trading/kernel/market/market-macro'
import type { NameContext } from '@/trading/markets/types'
import { AppError } from '@/core/errors'
import { buildUuidV7Id, parseUuidV7Id } from '@/trading/kernel/instrument'

export type AnalysisId = string & BrandTag<'AnalysisId'>

/** What an analysis is asked: a name, a language and who pays. No focus, no depth and no `force`,
 *  because none of them means anything to a run that decides nothing. */
export type AnalysisRequest = Pick<
  SuggestionRequest,
  | 'locale'
  | 'channel'
  | 'billingSessionId'
  | 'parentRunId'
  | 'billingAgentId'
  | 'ticker'
  | 'market'
  | 'now'
  | 'progress'
>

/** Both sides argued from one body of evidence, and what the evidence said back. It carries no
 *  verdict, size, entry, stop, target or conviction: none was ever produced, so there is none to
 *  hide. It is never a `DebateResult` arm and never reaches `finalize`. */
export interface AnalysisResult {
  readonly bull: AnalysisCase
  readonly bear: AnalysisCase
  readonly verification: ClaimVerification
  /** The claims the verifier checked: every claim both sides made. */
  readonly claims: readonly StoredClaim[]
  readonly playbook: readonly string[]
  readonly models: readonly string[]
}

export interface AnalysisRecord {
  readonly id: AnalysisId
  readonly instrument: InstrumentRef
  /** The run's own day. */
  readonly at: TradingDay
  /** The newest settled session the readings stand on. Absent when no bar series reached the run. */
  readonly evidenceThrough?: TradingDay
  /** The settled close on `evidenceThrough`, in the market's own price units: the price the run
   *  stands on. Absent when no bar series reached the run, and on a row stored before it was kept. */
  readonly evidenceClose?: number
  readonly authoredLocale: Locale
  readonly createdAt: number
  readonly result: AnalysisResult
  readonly citations: readonly SuggestionCitation[]
  /** The headlines both sides were handed that no claim cited, so the reader can open what the
   *  analysis read and not only what it leaned on. */
  readonly headlines: readonly SuggestionCitation[]
  /** The factor readings both sides argued from, each as published: a value or a rank among peers.
   *  Never a factor's score, weight or the composite, which would weigh one side over the other. */
  readonly figures: readonly FactorMetric[]
  /** How the market's board prints a price, for the price readings among the figures. Absent where
   *  the market prints plain amounts, and on a row stored before it was kept. */
  readonly boardScale?: { readonly currency: CurrencyCode; readonly display: PriceDisplay }
  /** The currency the money readings are in. Absent on a row stored before it was kept. */
  readonly currency?: CurrencyCode
  /** The measure the prices are per, where the ticker does not imply it (world gold: per ounce).
   *  Absent on a row stored before it was kept, which prints the bare currency. */
  readonly quoteUnit?: QuoteUnit
  /** The medians of the name's own sector, beside the readings of the name that have one. Absent
   *  where the market has no sector view of the name or the sector is too thin to state one. */
  readonly sector?: NonNullable<NameContext['sector']>
  /** The name's dated events in the days ahead, soonest first and as the provider worded them. */
  readonly upcoming?: readonly Pick<
    MarketEvent,
    'at' | 'kind' | 'title' | 'detail' | 'composedText' | 'writtenIn'
  >[]
  /** Where the market stands, as plain numbers: its heaviest macro series and the session's
   *  breadth. No regime and no composite, which would be a verdict. */
  readonly backdrop?: {
    readonly macro: readonly {
      readonly id: MacroSeriesId
      readonly unit: MacroUnit
      readonly value: number
    }[]
    readonly breadth?: NonNullable<NameContext['breadth']>
  }
  readonly caveats: readonly Caveat[]
}

export type AnalysisFailure =
  /** The name could not be analyzed, for the reason `/suggest` would give. */
  | {
      readonly kind: 'refused'
      readonly refusal: Extract<SuggestionRunResult, { readonly kind: 'unsupported' }>
    }
  /** A role did not answer, and `caveat.detail.cause` says why in the provider's own terms. */
  | { readonly kind: 'incomplete'; readonly caveat: Caveat }

/** A run that stored nothing. A cancelled run throws the abort itself, never this. */
export class AnalysisError extends AppError {
  readonly code = 'analysis' as const

  constructor(
    readonly failure: AnalysisFailure,
    message: string
  ) {
    super(message)
  }
}

export function analysisId(raw: string): AnalysisId {
  return parseUuidV7Id<AnalysisId>(raw, 'AnalysisId')
}

export function buildAnalysisId(now: number): AnalysisId {
  return buildUuidV7Id<AnalysisId>(now, 'AnalysisId')
}
