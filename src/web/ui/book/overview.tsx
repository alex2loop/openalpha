import type { TradingPortfolioResponse } from '@/app/server/wire/trading'
import { readBlock } from '@/web/state/block'
import { heldPositions, holdingsBlock } from '@/web/state/market'
import { formatPrice, WHOLE_DISPLAY } from '@/web/text/figures'
import { segmentName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'
import { HoldingsList } from '@/web/ui/book/holdings-list'
import { SegmentBars } from '@/web/ui/book/segment-bars'
import { Unrealized } from '@/web/ui/book/unrealized'
import { PieIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** Tổng quan: the total, what is held and how the segments stand against their targets. */
export function Overview() {
  return (
    <BlockFrame
      title={tr('ui.office.book.total')}
      colour="green"
      icon={<PieIcon />}
      reading={readBlock(holdingsBlock)}
      readKey="ui.office.book.pricedAt"
    >
      {(book) => <OverviewBody book={book} />}
    </BlockFrame>
  )
}

function OverviewBody({ book }: { readonly book: TradingPortfolioResponse }) {
  if (heldPositions.value.length === 0) {
    return <p class="meta">{tr('ui.office.book.empty')}</p>
  }

  return (
    <>
      <p class="big-figure">
        {formatPrice(book.navBase, WHOLE_DISPLAY)} {book.baseCurrency}
      </p>
      <p class="meta">
        {segmentName('cash')} {formatPrice(book.cashBase, WHOLE_DISPLAY)} {book.baseCurrency}
      </p>
      <Unrealized book={book} />
      <h3 class="sub-head">{tr('ui.office.book.holding')}</h3>
      <HoldingsList positions={heldPositions.value} />
      <h3 class="sub-head">{tr('ui.office.book.bySegment')}</h3>
      <SegmentBars shares={book.shares} />
    </>
  )
}
