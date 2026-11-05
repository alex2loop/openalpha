import type { Locale } from '@/core/types/locale'
import type { AnalysisFailure } from '@/trading/features/suggestion/analysis/types'
import { LLM_ERROR_CODES } from '@/core/llm'
import { type MessageKey, t } from '@/i18n'
import { renderUnsupportedReason } from '@/trading/features/suggestion/render/verdict'
import { INLINE_SEPARATOR } from '@/trading/render/layout'

/** The ceilings a call is refused at before it is sent, when its estimated cost would cross one: a
 *  single call above the run's ceiling, which a cheaper model fixes, or a period already spent. */
const SPEND_CAP_KEYS = new Map<unknown, MessageKey>([
  ['run_budget', 'trading.analysis.over-cap'],
  ['daily_cap', 'trading.analysis.cap-spent'],
  ['monthly_cap', 'trading.analysis.cap-spent'],
  ['agent_daily_cap', 'trading.analysis.cap-spent'],
])

/** Why a run stored nothing, in the reader's language: why the name cannot be analysed, or why a role
 *  did not answer, with the provider's own words where it gave them. */
export function renderAnalysisFailure(locale: Locale, failure: AnalysisFailure): string {
  if (failure.kind === 'refused') {
    return renderUnsupportedReason(locale, failure.refusal)
  }

  const { cause, reason } = failure.caveat.detail ?? {}
  const wording = t(locale, reasonKeyOf(cause))

  return t(locale, 'trading.analysis.not-finished', {
    reason: typeof reason === 'string' ? `${wording}${INLINE_SEPARATOR}${reason}` : wording,
  })
}

function reasonKeyOf(cause: unknown): MessageKey {
  const capKey = SPEND_CAP_KEYS.get(cause)

  if (capKey !== undefined) {
    return capKey
  }

  const known = LLM_ERROR_CODES.find((code) => code === cause)

  return known === undefined ? 'llmErrors.fatal' : `llmErrors.${known}`
}
