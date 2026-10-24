import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type {
  ActionableStoredSuggestion,
  SuggestionOutcome,
} from '@/trading/features/suggestion/types'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { CallScoredPayload, TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { Market } from '@/trading/markets/types'
import { MS_PER_DAY } from '@/core/utils/time'
import { formatDay, t } from '@/i18n'
import { sendCaught } from '@/trading/kernel/operator/delivery-retry'
import { isBookCall } from '@/trading/kernel/operator/focus'
import { formatSignedFraction, renderDeclaredValue } from '@/trading/render/format'

/** The first pass after this ships scores calls that waited a long time; a call whose window ended
 *  longer ago than this is history, and would otherwise flood the bell. */
const CALL_SCORED_MAX_AGE_MS = 2 * MS_PER_DAY

/** Where a scored call is told: the daemon's sender, the chat it would use, and the language. */
export interface CallScoredNotices {
  readonly sender: TradingNoticeSender
  recipient(): DeliveryAddress | undefined
  readonly locale: Locale
}

interface ScoredCall {
  readonly suggestion: ActionableStoredSuggestion
  readonly market: Market
  readonly outcome: SuggestionOutcome
}

/** Tells the operator a call was just scored, once: the caller asks only when the store took the
 *  result, so a retried tick never repeats it. A refusal is logged and not retried. Only the
 *  operator's own calls are told: a focus call is a second opinion scored apart from their record,
 *  and a daily agent would otherwise fill the bell with lines that say it counts in it. */
export async function notifyCallScored(
  deps: CallScoredNotices & { readonly logger: Logger },
  scored: ScoredCall,
  at: { readonly now: number; readonly signal: AbortSignal }
): Promise<void> {
  const { suggestion, market, outcome } = scored

  if (!isBookCall(suggestion)) {
    return
  }

  const windowEndedAt = market.manifest.calendar.sessionCloseAt(outcome.exitDay)
  const target = deps.recipient()

  if (target === undefined || at.now - windowEndedAt > CALL_SCORED_MAX_AGE_MS) {
    return
  }

  const { benchmark } = market.manifest
  const sent = await sendCaught(
    deps.sender,
    {
      target,
      locale: deps.locale,
      payload: {
        kind: 'call-scored',
        suggestionId: suggestion.id,
        instrument: suggestion.instrument,
        action: suggestion.action,
        status: outcome.status,
        returnPct: outcome.returnPct,
        ...(benchmark === undefined || outcome.benchmarkReturnPct === undefined
          ? {}
          : { benchmark: { instrument: benchmark, returnPct: outcome.benchmarkReturnPct } }),
        focusKey: suggestion.focusKey,
        day: suggestion.at,
      },
    },
    at.signal
  )

  if (sent !== 'accepted') {
    deps.logger.warn('trading.call_scored_undelivered', { id: suggestion.id, outcome: sent })
  }
}

/** The verdict on one scored call, and how the market's own benchmark did over the same span when
 *  the market names one. Both returns are fractions. */
export function renderCallScoredNotice(locale: Locale, payload: CallScoredPayload): string {
  const { benchmark } = payload
  const verdict = t(locale, `trading.scored.${payload.status}`, {
    action: renderDeclaredValue(locale, `trading.action.${payload.action}`),
    ticker: payload.instrument.ticker,
    day: formatDay(locale, payload.day),
    return: formatSignedFraction(locale, payload.returnPct),
  })

  if (benchmark === undefined) {
    return verdict
  }

  const comparison = t(locale, 'trading.scored.benchmark', {
    benchmark: benchmark.instrument.ticker,
    benchmarkReturn: formatSignedFraction(locale, benchmark.returnPct),
  })

  return `${verdict} ${comparison}`
}
