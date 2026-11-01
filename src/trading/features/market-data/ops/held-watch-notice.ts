import type { Locale } from '@/core/types/locale'
import type { HeldNewsPayload, IndexDropPayload } from '@/trading/kernel/operator/notice'
import { pluralKey, t } from '@/i18n'
import { formatCount, formatPercent } from '@/trading/render/format'

/** What a name the operator holds was just written about, and by whom. */
export function renderHeldNewsNotice(locale: Locale, payload: HeldNewsPayload): string {
  return t(locale, 'trading.heldNews.body', {
    ticker: payload.instrument.ticker,
    title: payload.title,
    source: payload.source,
  })
}

/** The fall in the index, and how the book stands against it: how many holdings are down, how many of
 *  those have gone through their stop, and how many stops could not be checked. `movePct` is a percent,
 *  so it takes the percent family. */
export function renderIndexDropNotice(locale: Locale, payload: IndexDropPayload): string {
  const params = {
    index: payload.index.ticker,
    move: formatPercent(locale, Math.abs(payload.movePct)),
    held: t(
      locale,
      pluralKey(payload.heldDown, 'trading.indexDrop.heldOne', 'trading.indexDrop.held'),
      {
        count: formatCount(locale, payload.heldDown),
      }
    ),
    broken: t(
      locale,
      pluralKey(payload.stopsBroken, 'trading.indexDrop.brokenOne', 'trading.indexDrop.broken'),
      { count: formatCount(locale, payload.stopsBroken) }
    ),
    unread: formatCount(locale, payload.stopsUnread),
  }

  if (payload.stopsUnread > 0) {
    return t(locale, 'trading.indexDrop.unread', params)
  }

  return t(
    locale,
    payload.stopsBroken > 0 ? 'trading.indexDrop.breach' : 'trading.indexDrop.body',
    params
  )
}
