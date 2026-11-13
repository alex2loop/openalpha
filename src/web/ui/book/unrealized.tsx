import type { AbsolutePositionWire, TradingPortfolioResponse } from '@/app/server/wire/trading'
import { formatSignedMoney, formatSignedPercent, PERCENT, toneOfMoney } from '@/web/text/figures'
import { tr } from '@/web/text/tr'

/** "Lãi/lỗ chưa chốt": the engine's book figure in the book's currency, beside its percent of what
 *  the holdings cost. The engine leaves both out while any holding or currency cash is unpriced, so
 *  nothing shows rather than a partial figure. */
export function Unrealized({ book }: { readonly book: TradingPortfolioResponse }) {
  const { unrealizedPnlBase: profit, investedBase: invested } = book

  if (profit === undefined || invested === undefined || invested <= 0) {
    return null
  }

  const percent = (profit / invested) * PERCENT

  return (
    <p>
      {tr('ui.office.today.bookPnl')}{' '}
      <b class={`is-${toneOfMoney(profit, book.baseCurrency)}-text`}>
        {formatSignedMoney(profit, book.baseCurrency)} ({formatSignedPercent(percent)})
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
