import type { AbsolutePositionWire, TradingPortfolioResponse } from '@/app/server/wire/trading'
import {
  formatPrice,
  formatSignedPercent,
  PERCENT,
  toneOfPercent,
  WHOLE_DISPLAY,
} from '@/web/text/figures'
import { tr } from '@/web/text/tr'

// Priced holdings only: an unpriced one adds to neither side, so the percent stays honest.
/** "Lãi/lỗ chưa chốt": the sum over the priced holdings, in the book's currency, beside its percent
 *  of what they cost. */
export function Unrealized({ book }: { readonly book: TradingPortfolioResponse }) {
  const priced = book.positions.filter((position) => position.unrealizedPnlBase !== undefined)
  const profit = priced.reduce((sum, position) => sum + (position.unrealizedPnlBase ?? 0), 0)
  const invested = priced.reduce((sum, position) => sum + position.investedBase, 0)

  if (priced.length === 0 || invested <= 0) {
    return null
  }

  const percent = (profit / invested) * PERCENT

  return (
    <p>
      {tr('ui.office.today.bookPnl')}{' '}
      <b class={`is-${toneOfPercent(percent)}-text`}>
        {formatPrice(profit, WHOLE_DISPLAY)} ({formatSignedPercent(percent)})
      </b>
    </p>
  )
}

/** What one holding has gained or lost against what it cost, as a percent; an unpriced one has no
 *  move to print. */
export function toMovePercent(position: AbsolutePositionWire): number | undefined {
  const { unrealizedPnlBase, investedBase } = position

  return unrealizedPnlBase === undefined || investedBase <= 0
    ? undefined
    : (unrealizedPnlBase / investedBase) * PERCENT
}
