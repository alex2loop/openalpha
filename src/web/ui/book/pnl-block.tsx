import type { AbsolutePositionWire, TradingPortfolioResponse } from '@/app/server/wire/trading'
import { readBlock } from '@/web/state/block'
import { heldPositions, holdingsBlock } from '@/web/state/market'
import { formatSignedMoney, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { EmptyBookActions, emptyBookKey } from '@/web/ui/book/empty-actions'
import { PnlTotals } from '@/web/ui/book/pnl-totals'
import { toMovePercent, Unrealized } from '@/web/ui/book/unrealized'
import { CoinIcon } from '@/web/ui/kit/icons'
import { TickerLink } from '@/web/ui/ticker/ticker-link'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** "Lãi / lỗ": what each holding has made so far against what it cost, in the book's currency. */
export function PnlBlock() {
  return (
    <BlockFrame
      title={tr('ui.office.book.pnl')}
      colour="peach"
      icon={<CoinIcon />}
      reading={readBlock(holdingsBlock)}
    >
      {(book) => <PnlRows book={book} />}
    </BlockFrame>
  )
}

function PnlRows({ book }: { readonly book: TradingPortfolioResponse }) {
  const held = heldPositions.value

  // A book that sold everything still has what it made to show.
  if (held.length === 0 && !hasLedgerFigures(book)) {
    return (
      <>
        <p class="empty-note">{tr(emptyBookKey())}</p>
        <EmptyBookActions />
      </>
    )
  }

  return (
    <>
      <Unrealized book={book} />
      <PnlTotals book={book} />
      {held.length > 0 && <h3 class="sub-head">{tr('ui.office.book.holding')}</h3>}
      <div class="row-list">
        {held.map((position) => (
          <PnlRow
            key={`${position.instrument.market}:${position.instrument.ticker}`}
            position={position}
            currency={book.baseCurrency}
          />
        ))}
      </div>
    </>
  )
}

function hasLedgerFigures(book: TradingPortfolioResponse): boolean {
  return (book.netDepositsBase ?? 0) !== 0 || (book.realizedPnlBase ?? 0) !== 0
}

function PnlRow({
  position,
  currency,
}: {
  readonly position: AbsolutePositionWire
  readonly currency: string
}) {
  const move = toMovePercent(position)

  return (
    <div class="row">
      <b>
        <TickerLink ticker={position.instrument.ticker} market={position.instrument.market} />
      </b>
      <span>{formatSignedMoney(position.unrealizedPnlBase, currency)}</span>
      <span class={`pill is-${toneOfPercent(move)}`}>{formatSignedPercent(move)}</span>
    </div>
  )
}
