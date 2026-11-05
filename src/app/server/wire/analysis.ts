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
  /** What each side named that would show it wrong, in the words the model wrote them: statements
   *  to check later, not price levels. At least one per side. */
  readonly conditions: { readonly bull: readonly string[]; readonly bear: readonly string[] }
  /** The text `/suggest` answers with, written again in the request's language: the AI label, the
   *  price when analysed and now, both sides, what the evidence refuted, the figures read, the
   *  sources and the closing lines. The conditions and what the web edition does not do are left
   *  out, because the page lays those out itself; the rest is the chat's layout. */
  readonly text: string
}

/** GET /v1/analyses - newest first; `instrument` (`market` and `ticker`) narrows to one name. */
export interface AnalysesResponse {
  readonly analyses: readonly AnalysisWire[]
  readonly nextCursor?: string
}
