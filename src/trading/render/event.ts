import type { Locale } from '@/core/types/locale'
import type {
  InsiderPurchase,
  InsiderRelationship,
  MarketEvent,
} from '@/trading/kernel/market/market-event'
import { type MessageKey, t } from '@/i18n'
import { formatQuantity, renderDeclaredValue } from '@/trading/render/format'
import { formatPriceIn } from '@/trading/render/money'

const RELATIONSHIP_KEYS = Object.freeze({
  director: 'trading.insider.relationship.director',
  'ten-percent-owner': 'trading.insider.relationship.ten-percent-owner',
} as const satisfies Record<InsiderRelationship, MessageKey>)

interface EventText {
  readonly title: string
  readonly detail?: string
}

/** What a person reads for an event. A provider's own words pass through as it wrote them; an event
 *  whose text an adapter composed in English is worded from its kind and facts instead, so a reader
 *  of either locale sees their own language. A dividend's terms ride the event's own fields. */
export function describeEvent(locale: Locale, event: MarketEvent): EventText {
  if (event.composedText !== true) {
    return { title: event.title, ...(event.detail === undefined ? {} : { detail: event.detail }) }
  }

  const title = renderDeclaredValue(locale, `trading.event.${event.kind}`)

  return event.insider === undefined
    ? { title }
    : { title, detail: describeInsiderPurchase(locale, event.insider) }
}

function describeInsiderPurchase(locale: Locale, purchase: InsiderPurchase): string {
  const role =
    purchase.officerTitle ??
    (purchase.relationship === undefined
      ? undefined
      : t(locale, RELATIONSHIP_KEYS[purchase.relationship]))
  const params = {
    who: role === undefined ? purchase.owner : `${purchase.owner} (${role})`,
    shares: formatQuantity(locale, purchase.shares),
  }

  return purchase.price === undefined
    ? t(locale, 'trading.insider.bought', params)
    : t(locale, 'trading.insider.bought-priced', {
        ...params,
        price: formatPriceIn(locale, purchase.price, { currency: purchase.currency }),
      })
}
