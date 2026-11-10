import type { Locale } from '@/core/types/locale'
import { t } from '@/i18n'
import { INLINE_SEPARATOR } from '@/trading/render/layout'

interface RestatementNotice {
  readonly tickers: readonly string[]
  readonly rebased?: readonly string[]
}

/** One notice for the whole pass: a paragraph for the names whose plans were closed and one for the
 *  names whose plans were converted to the new price scale, each printed only when it has names. A
 *  routine event: the operator's position did not change, only the prices the plan was built on. */
export function renderRestatementNotice(locale: Locale, notice: RestatementNotice): string {
  const rebased = notice.rebased ?? []
  const closedLines =
    notice.tickers.length === 0
      ? []
      : [t(locale, 'trading.restatement.body', { tickers: notice.tickers.join(INLINE_SEPARATOR) })]
  const rebasedLines =
    rebased.length === 0
      ? []
      : [t(locale, 'trading.restatement.rebased', { tickers: rebased.join(INLINE_SEPARATOR) })]

  return [t(locale, 'trading.notice.series-restated'), ...closedLines, ...rebasedLines].join('\n')
}
