import type { BrandTag } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { SuggestionCitation } from '@/trading/features/suggestion/citation'
import type {
  AnalysisCase,
  ClaimVerification,
  StoredClaim,
} from '@/trading/features/suggestion/debate/types'
import type { SuggestionRequest } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MarketResolution } from '@/trading/markets/types'
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
  readonly caveats: readonly Caveat[]
}

export type AnalysisFailure =
  | {
      readonly kind: 'unresolved'
      readonly resolution: Exclude<MarketResolution, { readonly kind: 'resolved' }>
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
