// /v1/analyses contract: what an analysis-only run stored. Both sides argued from one body of
// evidence and the claims were checked against it. There is no verdict, size, entry, stop, target
// or conviction here, because none was produced.

import type { InstrumentRefWire, TradingWireCaveat } from '@/app/server/wire/trading'
import type { Locale } from '@/core/types/locale'

interface AnalysisCitationWire {
  readonly url: string
  readonly title?: string
  readonly publishedAt?: number
}

interface AnalysisCaseWire {
  readonly stance: 'bullish' | 'bearish' | 'neutral'
  readonly summary: string
  readonly claims: readonly string[]
  /** What the side itself says would make its case wrong. */
  readonly invalidators: readonly string[]
  readonly citations: readonly AnalysisCitationWire[]
}

/** `insufficient` is also what a claim the verifier never answered reads as: the evidence carried
 *  nothing on it either way. */
interface AnalysisClaimWire {
  readonly id: string
  readonly text: string
  readonly verdict: 'supported' | 'refuted' | 'insufficient'
}

export interface AnalysisWire {
  readonly id: string
  readonly instrument: InstrumentRefWire
  /** The run's own day. */
  readonly at: string
  /** The newest settled session the readings stand on; absent when no bar series reached the run. */
  readonly evidenceThrough?: string
  readonly authoredLocale: Locale
  readonly createdAt: number
  readonly bull: AnalysisCaseWire
  readonly bear: AnalysisCaseWire
  readonly claims: readonly AnalysisClaimWire[]
  readonly citations: readonly AnalysisCitationWire[]
  readonly caveats: readonly TradingWireCaveat[]
  /** The models that argued it, sorted. */
  readonly models: readonly string[]
}

/** GET /v1/analyses — newest first; `instrument` (`market` and `ticker`) narrows to one name. */
export interface AnalysesResponse {
  readonly analyses: readonly AnalysisWire[]
  readonly nextCursor?: string
}
