import type { Locale } from '@/core/types/locale'
import type { OrphanExit } from '@/trading/features/order/types'
import type { VenueRef } from '@/trading/kernel/instrument'
import { t } from '@/i18n'
import {
  formatAmount,
  formatQuantity,
  renderVenueName,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, renderSectionTitle } from '@/trading/render/layout'

const VENUE_SEPARATOR = ', '

interface OrphanExitsInput {
  readonly locale: Locale
  readonly orphans: readonly OrphanExit[]
  /** Venues whose exits could not be listed, so nothing is known about them. */
  readonly unread: readonly VenueRef[]
}

/** Exits resting at a venue that this book does not track. No instrument is known for a row, so a
 *  trigger prints as the bare number the exchange holds rather than in a market's convention. */
export function renderOrphanExits(input: OrphanExitsInput): string {
  const { locale } = input
  const found = input.orphans.length > 0

  return [
    renderSectionTitle(SECTION_ICONS.order, t(locale, 'trading.order.orphanExits.title')),
    ...input.orphans.map((orphan) => `${INDENT[1]}${orphanRow(locale, orphan)}`),
    ...(found ? [`${INDENT[1]}${t(locale, 'trading.order.orphanExits.remedy')}`] : []),
    ...(input.unread.length === 0
      ? []
      : [
          `${INDENT[1]}${t(locale, 'trading.order.orphanExits.unread', {
            venues: input.unread
              .map((venue) => renderVenueName(locale, venue))
              .join(VENUE_SEPARATOR),
          })}`,
        ]),
  ].join('\n')
}

function orphanRow(locale: Locale, orphan: OrphanExit): string {
  return [
    t(locale, 'trading.order.status.exitRow', {
      quantity: formatQuantity(locale, orphan.quantity),
      ticker: orphan.symbol,
      venue: renderVenueName(locale, orphan.venue),
    }),
    ...(orphan.takeProfit === undefined
      ? []
      : [
          t(locale, 'trading.order.exit.takeProfit', {
            price: formatAmount(locale, orphan.takeProfit),
          }),
        ]),
    ...(orphan.stopLoss === undefined
      ? []
      : [
          t(locale, 'trading.order.exit.stopLoss', {
            price: formatAmount(locale, orphan.stopLoss),
          }),
        ]),
    t(locale, 'trading.order.orphanExits.exitId', { exitId: orphan.exitId }),
  ].join(INLINE_SEPARATOR)
}
