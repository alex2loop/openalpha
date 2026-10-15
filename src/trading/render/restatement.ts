import type { Locale } from '@/core/types/locale'
import { t } from '@/i18n'
import { INLINE_SEPARATOR } from '@/trading/render/layout'

/** One notice for the whole pass, naming the tickers whose plans were closed. A routine event read
 *  as one sentence: the operator's position did not change, only the prices the plan was built on. */
export function renderRestatementNotice(locale: Locale, tickers: readonly string[]): string {
  return [
    t(locale, 'trading.notice.series-restated'),
    t(locale, 'trading.restatement.body', { tickers: tickers.join(INLINE_SEPARATOR) }),
  ].join('\n')
}
