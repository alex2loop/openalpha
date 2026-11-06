import type { ComponentChildren } from 'preact'

import type { TradingPortfolioResponse } from '@/app/server/wire/trading'
import { formatPrice, formatSignedFraction, toneOfPercent, WHOLE_DISPLAY } from '@/web/text/figures'
import { tr } from '@/web/text/tr'

/** What was put in, what closed trades and dividends made, the fees still in the cost of what is
 *  held, and the total against what was put in, in the book's currency. A line the daemon did not
 *  send is left out; fees and dividends only once there are some. */
export function PnlTotals({ book }: { readonly book: TradingPortfolioResponse }) {
  const { baseCurrency, netDepositsBase, realizedPnlBase, dividendsBase, feesBase, totalPnlBase } =
    book
  const money = (value: number): string => `${formatPrice(value, WHOLE_DISPLAY)} ${baseCurrency}`

  return (
    <div class="row-list">
      {netDepositsBase !== undefined && (
        <FigureRow label={tr('ui.office.book.netDeposits')}>{money(netDepositsBase)}</FigureRow>
      )}
      {realizedPnlBase !== undefined && (
        <FigureRow label={tr('ui.office.book.realizedPnl')} signedBy={realizedPnlBase}>
          {money(realizedPnlBase)}
        </FigureRow>
      )}
      {dividendsBase !== undefined && dividendsBase !== 0 && (
        <FigureRow label={tr('ui.office.book.dividends')}>{money(dividendsBase)}</FigureRow>
      )}
      {feesBase !== undefined && feesBase !== 0 && (
        <FigureRow label={tr('ui.office.book.fees')}>{money(feesBase)}</FigureRow>
      )}
      {totalPnlBase !== undefined && (
        <FigureRow label={tr('ui.office.book.totalPnl')} signedBy={totalPnlBase}>
          {money(totalPnlBase)}
          {netDepositsBase !== undefined && netDepositsBase > 0 && (
            <> ({formatSignedFraction(totalPnlBase / netDepositsBase)})</>
          )}
        </FigureRow>
      )}
    </div>
  )
}

/** `signedBy` colours the figure by its direction; absent, it is a plain amount. */
function FigureRow({
  label,
  signedBy,
  children,
}: {
  readonly label: string
  readonly signedBy?: number
  readonly children: ComponentChildren
}) {
  return (
    <div class="row figure-row">
      <span>{label}</span>
      <b class={signedBy === undefined ? undefined : `is-${toneOfPercent(signedBy)}-text`}>
        {children}
      </b>
    </div>
  )
}
