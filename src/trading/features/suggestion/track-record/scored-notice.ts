import type { Locale } from '@/core/types/locale'
import type { CallScoredPayload } from '@/trading/kernel/operator/notice'
import { formatDay, t } from '@/i18n'
import { formatSignedFraction, renderDeclaredValue } from '@/trading/render/format'

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
