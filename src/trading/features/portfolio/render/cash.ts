import type { Locale } from '@/core/types/locale'
import type { BookDisplay } from '@/trading/features/portfolio/render/rows'
import type { ValuedBook } from '@/trading/features/portfolio/types'
import { formatDay, t } from '@/i18n'
import {
  closedRoundTripsOf,
  recentClosedRoundTrips,
} from '@/trading/features/portfolio/folds/holdings'
import { formatSignedFraction, renderVenueName, SECTION_ICONS } from '@/trading/render/format'
import { INDENT, renderSectionTitle, toFactLines } from '@/trading/render/layout'
import { formatMoney, formatSignedMoney } from '@/trading/render/money'

/** The cash block's own keys, named so the shared row builder stays type-checked against the
 *  catalog instead of widening to any string. */
type CashKey = 'cash' | 'cashAvailable' | 'invested' | 'fees'

/** Cash on hand, what of it has cleared, and what the closed and open trades did to it. Money the
 *  operator cannot spend yet is listed by the day it clears rather than left to be subtracted. */
export function renderCashSection(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  const { cashBase, availableCashBase, pendingCash } = book.book
  const money = (key: CashKey, value: number): string =>
    `${INDENT[1]}${t(locale, `trading.render.portfolio.${key}`, {
      amount: formatMoney(locale, value, display.currency),
    })}`

  return [
    renderSectionTitle(SECTION_ICONS.cash, t(locale, 'trading.render.portfolio.cashTitle')),
    money('cash', cashBase),
    ...renderCashVenueLine(locale, book, display),
    // Only while a sale is unsettled: money you have but cannot spend yet.
    ...(pendingCash.length === 0 ? [] : [money('cashAvailable', availableCashBase)]),
    ...pendingCash.map(
      (pending) =>
        `${INDENT[2]}${t(locale, 'trading.render.portfolio.pendingRow', {
          amount: formatMoney(locale, pending.amountBase, display.currency),
          day: formatDay(locale, pending.availableAt),
        })}`
    ),
    ...(book.investedBase === undefined ? [] : [money('invested', book.investedBase)]),
    ...(book.feesBase === undefined || book.feesBase === 0 ? [] : [money('fees', book.feesBase)]),
    ...(book.unrealizedPnlBase === undefined
      ? []
      : [
          `${INDENT[1]}${t(locale, 'trading.render.portfolio.pnl', {
            pnl: formatSignedMoney(locale, book.unrealizedPnlBase, display.currency),
          })}`,
        ]),
    ...(book.unrealizedFxPnlBase === undefined
      ? []
      : [
          `${INDENT[2]}${t(locale, 'trading.render.portfolio.pnlFxShare', {
            fx: formatSignedMoney(locale, book.unrealizedFxPnlBase, display.currency),
          })}`,
        ]),
    `${INDENT[1]}${t(locale, 'trading.render.portfolio.realizedPnl', {
      pnl: formatSignedMoney(locale, book.realizedPnlBase, display.currency),
    })}`,
    ...renderClosedLines(locale, book, display),
  ]
}

/** What the recent closed round trips realized, newest first, under the total. */
function renderClosedLines(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  const trips = closedRoundTripsOf(book.book.sales, display.minimumSizes ?? new Map())

  return recentClosedRoundTrips(trips).map(
    (trip) =>
      `${INDENT[2]}${t(locale, 'trading.render.portfolio.closedRow', {
        ticker: trip.instrument.ticker,
        day: formatDay(locale, trip.closedAt),
        fraction: formatSignedFraction(locale, trip.realizedFraction),
        amount: formatSignedMoney(locale, trip.realizedBase, display.currency),
      })}`
  )
}

/** Only where cash actually spans custodians: one venue makes the split a restatement of the total
 *  above it. The same one-line shape a holding's venue split uses, so the block carries one device. */
function renderCashVenueLine(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  const held = [...book.book.cashByVenue].filter(([, venueCash]) => venueCash.cash !== 0)

  if (held.length < 2) {
    return []
  }

  const [first, ...rest] = held.map(
    ([venue, venueCash]) =>
      `${renderVenueName(locale, venue)} ${formatMoney(locale, venueCash.cash, display.currency)}`
  )

  if (first === undefined) {
    return []
  }

  return toFactLines(
    [t(locale, 'trading.render.portfolio.cashVenueSplit', { first }), ...rest],
    display.context,
    2
  )
}
