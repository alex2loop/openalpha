import type { Locale } from '@/core/types/locale'
import type { BookDisplay } from '@/trading/features/portfolio/render/rows'
import type { ValuedBook } from '@/trading/features/portfolio/types'
import { formatDay, t } from '@/i18n'
import {
  closedRoundTripsOf,
  recentClosedRoundTrips,
} from '@/trading/features/portfolio/folds/holdings'
import { formatSignedFixedFraction, renderVenueName, SECTION_ICONS } from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  renderOverflowLine,
  renderSectionTitle,
  toFactLines,
} from '@/trading/render/layout'
import { formatMoney, formatSignedMoney } from '@/trading/render/money'
import { FRACTION_QUANTUM } from '@/trading/render/number'
import { toTable } from '@/trading/render/table'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** The money rows' own keys, named so the shared row builder stays type-checked against the
 *  catalog instead of widening to any string. */
type MoneyKey = 'cashAvailable' | 'invested' | 'fees'

/** Two sections: cash on hand and what of it has cleared, then what the open and closed trades made.
 *  Money the operator cannot spend yet is listed by the day it clears rather than left to be
 *  subtracted. */
export function renderCashSections(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly (readonly string[])[] {
  const { cashBase, availableCashBase, pendingCash } = book.book
  const money = (key: MoneyKey, value: number, depth: 1 | 2 = 1): string =>
    `${INDENT[depth]}${t(locale, `trading.render.portfolio.${key}`, {
      amount: formatMoney(locale, value, display.currency),
    })}`

  return [
    [
      renderSectionTitle(
        SECTION_ICONS.cash,
        t(locale, 'trading.render.portfolio.cashTitle', {
          amount: formatMoney(locale, cashBase, display.currency),
        })
      ),
      ...renderCashVenueLine(locale, book, display),
      ...renderCurrencyCashRows(locale, book, display),
      // Only while a sale is unsettled: money you have but cannot spend yet.
      ...(pendingCash.length === 0 ? [] : [money('cashAvailable', availableCashBase)]),
      ...pendingCash.map(
        (pending) =>
          `${INDENT[2]}${t(locale, 'trading.render.portfolio.pendingRow', {
            amount: formatMoney(locale, pending.amountBase, display.currency),
            day: formatDay(locale, pending.availableAt),
          })}`
      ),
    ],
    [
      renderSectionTitle(SECTION_ICONS.pnl, t(locale, 'trading.render.portfolio.pnlTitle')),
      ...(book.investedBase === undefined ? [] : [money('invested', book.investedBase)]),
      ...(book.feesBase === undefined || book.feesBase === 0
        ? []
        : [money('fees', book.feesBase, 2)]),
      ...(book.unrealizedPnlBase === undefined
        ? []
        : [
            `${INDENT[1]}${t(locale, 'trading.render.portfolio.pnl', {
              pnl: formatSignedMoney(locale, book.unrealizedPnlBase, display.currency),
            })}`,
          ]),
      ...renderFxShareLine(locale, book, display),
      ...renderCurrencyCashGainLine(locale, book, display),
      `${INDENT[1]}${t(locale, 'trading.render.portfolio.realizedPnl', {
        pnl: formatSignedMoney(locale, book.realizedPnlBase, display.currency),
      })}`,
      ...renderClosedLines(locale, book, display),
    ],
  ]
}

/** The currency's share of the open result, only where it is worth a figure: a move that rounds to
 *  nothing against NAV is a number with nothing behind it. */
function renderFxShareLine(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  const fx = book.unrealizedFxPnlBase

  if (!isWorthAFigure(fx, book.navBase)) {
    return []
  }

  return [
    `${INDENT[2]}${t(locale, 'trading.render.portfolio.pnlFxShare', {
      fx: formatSignedMoney(locale, fx, display.currency),
    })}`,
  ]
}

/** What the foreign cash is worth today over what it cost, only where it is worth a figure. */
function renderCurrencyCashGainLine(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  const gain = book.currencyCashGainBase

  if (!isWorthAFigure(gain, book.navBase)) {
    return []
  }

  return [
    `${INDENT[2]}${t(locale, 'trading.render.portfolio.currencyCashGain', {
      amount: formatSignedMoney(locale, gain, display.currency),
    })}`,
  ]
}

/** A move that rounds to nothing against NAV is a number with nothing behind it. */
function isWorthAFigure(move: number | undefined, nav: number | undefined): move is number {
  return (
    move !== undefined && nav !== undefined && nav > 0 && Math.abs(move) / nav >= FRACTION_QUANTUM
  )
}

/** Each foreign cash the book holds: its amount, what it cost and what it is worth today. The title
 *  above prints `cashBase`, which carries it at cost, so these rows never read as more than it. A
 *  spent one is not listed. */
function renderCurrencyCashRows(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  return book.currencyCash.map(({ cash, valueBase }) => {
    const params = {
      venue: renderVenueName(locale, cash.venue),
      amount: formatMoney(locale, cash.amount, cash.currency),
      cost: formatMoney(locale, cash.costBase, display.currency),
    }

    return `${INDENT[2]}${
      valueBase === undefined
        ? t(locale, 'trading.render.portfolio.currencyCashUnpriced', params)
        : t(locale, 'trading.render.portfolio.currencyCashRow', {
            ...params,
            value: formatMoney(locale, valueBase, display.currency),
          })
    }`
  })
}

/** What the recent closed round trips realized, newest first, under the total. Columns line up
 *  where the destination holds a padded grid. */
function renderClosedLines(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  const trips = closedRoundTripsOf(book.book.sales, display.minimumSizes ?? new Map())
  // The structured view keeps the full count; a line layout is a phone, which gets the last few.
  const limit = display.context.layout === 'lines' ? SURFACE_LIMITS.closedTripsOnLines : undefined
  const shown = recentClosedRoundTrips(trips, limit)
  const cells = shown.map((trip) => [
    trip.instrument.ticker,
    t(locale, 'trading.render.portfolio.closedDay', { day: formatDay(locale, trip.closedAt) }),
    formatSignedFixedFraction(locale, trip.realizedFraction),
    formatSignedMoney(locale, trip.realizedBase, display.currency),
  ])
  const rows =
    display.context.layout === 'table'
      ? toTable(cells, ['left', 'left', 'right', 'right'])
      : cells.map((row) => row.join(INLINE_SEPARATOR))

  // The total above counts every trip, so the ones left off are counted rather than dropped.
  const hidden = trips.length - shown.length

  return [
    ...rows.map((row) => `${INDENT[2]}${row}`),
    ...(hidden > 0 ? [renderOverflowLine(locale, hidden)] : []),
  ]
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
