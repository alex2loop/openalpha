import type { AbsolutePositionWire, TradingPortfolioResponse } from '@/app/server/wire/trading'
import { readBlock } from '@/web/state/block'
import { heldPositions, holdingsBlock } from '@/web/state/market'
import { formatPrice, formatSignedPercent, toneOfPercent, WHOLE_DISPLAY } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { EmptyBookActions } from '@/web/ui/book/empty-actions'
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

  if (held.length === 0) {
    return (
      <>
        <p class="meta">{tr('ui.office.book.empty')}</p>
        <EmptyBookActions />
      </>
    )
  }

  return (
    <>
      <Unrealized book={book} />
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
      <span>
        {formatPrice(position.unrealizedPnlBase, WHOLE_DISPLAY)} {currency}
      </span>
      <span class={`pill is-${toneOfPercent(move)}`}>{formatSignedPercent(move)}</span>
    </div>
  )
}
