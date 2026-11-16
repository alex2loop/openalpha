import type { Locale } from '@/core/types/locale'
import type {
  EarningsSchedule,
  EarningsTiming,
  InsiderPurchase,
  InsiderRelationship,
  MarketEvent,
  MarketEventKind,
} from '@/trading/kernel/market/market-event'
import { type MessageKey, t } from '@/i18n'
import { formatQuantity, renderDeclaredValue } from '@/trading/render/format'
import { INLINE_SEPARATOR } from '@/trading/render/layout'
import { formatMoney, formatPriceIn } from '@/trading/render/money'

/** The title a person reads for each kind of event. */
export const EVENT_KEYS = Object.freeze({
  'additional-listing': 'trading.event.additional-listing',
  agm: 'trading.event.agm',
  delisting: 'trading.event.delisting',
  'dividend-ex-date': 'trading.event.dividend-ex-date',
  'earnings-date': 'trading.event.earnings-date',
  'earnings-release': 'trading.event.earnings-release',
  'auditor-change': 'trading.event.auditor-change',
  'bankruptcy-filing': 'trading.event.bankruptcy-filing',
  impairment: 'trading.event.impairment',
  'insider-purchase': 'trading.event.insider-purchase',
  'last-trading-day': 'trading.event.last-trading-day',
  'listing-deficiency': 'trading.event.listing-deficiency',
  listing: 'trading.event.listing',
  'margin-eligible': 'trading.event.margin-eligible',
  'margin-ineligible': 'trading.event.margin-ineligible',
  'meeting-ex-date': 'trading.event.meeting-ex-date',
  'non-reliance': 'trading.event.non-reliance',
  'rights-issue': 'trading.event.rights-issue',
  split: 'trading.event.split',
} as const satisfies Record<MarketEventKind, MessageKey>)

const RELATIONSHIP_KEYS = Object.freeze({
  director: 'trading.insider.relationship.director',
  'ten-percent-owner': 'trading.insider.relationship.ten-percent-owner',
} as const satisfies Record<InsiderRelationship, MessageKey>)

export const TIMING_KEYS = Object.freeze({
  'pre-market': 'trading.earnings.timing.pre-market',
  'after-close': 'trading.earnings.timing.after-close',
} as const satisfies Record<EarningsTiming, MessageKey>)

interface EventText {
  readonly title: string
  readonly detail?: string
}

/** What a person reads for an event. A provider's own words pass through as it wrote them, with
 *  the language they are written in noted where it is not the reader's; an event whose text an
 *  adapter composed in English is worded from its kind and facts instead, so a reader of either
 *  locale sees their own language. A dividend's terms ride the event's own fields. */
export function describeEvent(locale: Locale, event: MarketEvent): EventText {
  if (event.composedText !== true) {
    return noteLanguage(locale, event)
  }

  const title = renderDeclaredValue(locale, `trading.event.${event.kind}`)
  const detail = composedDetail(locale, event)

  return detail === undefined ? { title } : { title, detail }
}

function composedDetail(locale: Locale, event: MarketEvent): string | undefined {
  if (event.insider !== undefined) {
    return describeInsiderPurchase(locale, event.insider)
  }

  return event.earnings === undefined ? undefined : describeEarnings(locale, event.earnings)
}

/** The note closes the last line the event prints, so one note covers the title and the detail. */
function noteLanguage(locale: Locale, event: MarketEvent): EventText {
  const { title, detail, writtenIn } = event
  const note =
    writtenIn === undefined || writtenIn === locale
      ? ''
      : ` (${t(locale, `trading.render.language.${writtenIn}`)})`

  return detail === undefined ? { title: `${title}${note}` } : { title, detail: `${detail}${note}` }
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

/** When the company reports and what analysts expect it to earn a share; absent when the calendar
 *  states neither. */
export function describeEarnings(locale: Locale, earnings: EarningsSchedule): string | undefined {
  const { timing, epsForecast, currency } = earnings
  const parts = [
    ...(timing === undefined ? [] : [t(locale, TIMING_KEYS[timing])]),
    ...(epsForecast === undefined
      ? []
      : [
          t(locale, 'trading.earnings.forecast', {
            eps: formatMoney(locale, epsForecast, currency),
          }),
        ]),
  ]

  return parts.length === 0 ? undefined : parts.join(INLINE_SEPARATOR)
}
