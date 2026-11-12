import type { ComponentChildren } from 'preact'

import type { TradingPortfolioResponse } from '@/app/server/wire/trading'
import {
  formatMoney,
  formatSignedFraction,
  formatSignedMoney,
  type Tone,
  toneOfMoney,
} from '@/web/text/figures'
import { tr } from '@/web/text/tr'

/** What was put in, what closed trades and dividends made, the fees still in the cost of what is
 *  held, and the total against what was put in, in the book's currency. A line the daemon did not
 *  send is left out; fees and dividends only once there are some. */
export function PnlTotals({ book }: { readonly book: TradingPortfolioResponse }) {
  const { baseCurrency, netDepositsBase, realizedPnlBase, dividendsBase, feesBase, totalPnlBase } =
    book
  const money = (value: number): string => formatMoney(value, baseCurrency)
  const signedMoney = (value: number): string => formatSignedMoney(value, baseCurrency)
  const toneOf = (value: number): Tone => toneOfMoney(value, baseCurrency)

  return (
    <div class="row-list">
      {netDepositsBase !== undefined && (
        <FigureRow label={tr('ui.office.book.netDeposits')}>{money(netDepositsBase)}</FigureRow>
      )}
      {realizedPnlBase !== undefined && (
        <FigureRow label={tr('ui.office.book.realizedPnl')} tone={toneOf(realizedPnlBase)}>
          {signedMoney(realizedPnlBase)}
        </FigureRow>
      )}
      {dividendsBase !== undefined && dividendsBase !== 0 && (
        <FigureRow label={tr('ui.office.book.dividends')}>{money(dividendsBase)}</FigureRow>
      )}
      {feesBase !== undefined && feesBase !== 0 && (
        <FigureRow label={tr('ui.office.book.fees')}>{money(feesBase)}</FigureRow>
      )}
      {totalPnlBase !== undefined && (
        <FigureRow label={tr('ui.office.book.totalPnl')} tone={toneOf(totalPnlBase)}>
          {signedMoney(totalPnlBase)}
          {netDepositsBase !== undefined && netDepositsBase > 0 && (
            <> ({formatSignedFraction(totalPnlBase / netDepositsBase)})</>
          )}
        </FigureRow>
      )}
    </div>
  )
}

/** `tone` colours the figure by its direction; absent, it is a plain amount. */
function FigureRow({
  label,
  tone,
  children,
}: {
  readonly label: string
  readonly tone?: Tone
  readonly children: ComponentChildren
}) {
  return (
    <div class="row figure-row">
      <span>{label}</span>
      <b class={tone === undefined ? undefined : `is-${tone}-text`}>{children}</b>
    </div>
  )
}
