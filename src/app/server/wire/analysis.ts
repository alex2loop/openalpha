// /v1/analyses contract: what an analysis-only run stored, as the chat answered it. There is no
// verdict, size, entry, stop, target or conviction here, because none was produced.

import type { InstrumentRefWire } from '@/app/server/wire/trading'
import type { Locale } from '@/core/types/locale'

export interface AnalysisWire {
  readonly id: string
  readonly instrument: InstrumentRefWire
  /** The run's own day. */
  readonly at: string
  readonly authoredLocale: Locale
  readonly createdAt: number
  /** The text `/suggest` answers with, written again in the request's language: the AI label, the
   *  price when analysed and now, both sides, what the evidence refuted, the figures read, the
   *  sources and the closing lines. The one layout of an analysis, so the list and the chat cannot
   *  differ. */
  readonly text: string
}

/** GET /v1/analyses - newest first; `instrument` (`market` and `ticker`) narrows to one name. */
export interface AnalysesResponse {
  readonly analyses: readonly AnalysisWire[]
  readonly nextCursor?: string
}
