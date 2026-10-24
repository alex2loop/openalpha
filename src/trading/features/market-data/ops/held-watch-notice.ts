import type { Locale } from '@/core/types/locale'
import type { HeldNewsPayload, IndexDropPayload } from '@/trading/kernel/operator/notice'
import { t } from '@/i18n'
import { formatCount, formatPercent } from '@/trading/render/format'

/** What a name the operator holds was just written about, and by whom. */
export function renderHeldNewsNotice(locale: Locale, payload: HeldNewsPayload): string {
  return t(locale, 'trading.heldNews.body', {
    ticker: payload.instrument.ticker,
    title: payload.title,
    source: payload.source,
  })
}

/** The fall in the index, and how the book stands against it: how many holdings are down, and how
 *  many of those have gone through their stop. `movePct` is a percent, so it takes the percent family. */
export function renderIndexDropNotice(locale: Locale, payload: IndexDropPayload): string {
  const params = {
    index: payload.index.ticker,
    move: formatPercent(locale, Math.abs(payload.movePct)),
    held: formatCount(locale, payload.heldDown),
  }

  if (payload.stopsBroken === 0) {
    return t(locale, 'trading.indexDrop.body', params)
  }

  return t(locale, 'trading.indexDrop.breach', {
    ...params,
    count: formatCount(locale, payload.stopsBroken),
  })
}
