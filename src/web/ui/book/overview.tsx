import type { TradingPortfolioResponse } from '@/app/server/wire/trading'
import { readBlock } from '@/web/state/block'
import { heldPositions, holdingsBlock } from '@/web/state/market'
import { formatMoney } from '@/web/text/figures'
import { segmentName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'
import { EmptyBookActions, emptyBookKey } from '@/web/ui/book/empty-actions'
import { HoldingsList } from '@/web/ui/book/holdings-list'
import { SegmentBars } from '@/web/ui/book/segment-bars'
import { Unrealized } from '@/web/ui/book/unrealized'
import { PieIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'
import { Events } from '@/web/ui/today/blocks/events'

/** Tổng quan: the total, what is held and how the segments stand against their targets, then the
 *  dates coming up for what is held. */
export function Overview() {
  return (
    <>
      <BlockFrame
        title={tr('ui.office.book.total')}
        colour="green"
        icon={<PieIcon />}
        reading={readBlock(holdingsBlock)}
        readKey="ui.office.book.pricedAt"
      >
        {(book) => <OverviewBody book={book} />}
      </BlockFrame>
      {heldPositions.value.length > 0 && <Events />}
    </>
  )
}

function OverviewBody({ book }: { readonly book: TradingPortfolioResponse }) {
  if (heldPositions.value.length === 0) {
    return (
      <>
        <p class="empty-note">{tr(emptyBookKey())}</p>
        <EmptyBookActions />
      </>
    )
  }

  return (
    <>
      <p class="big-figure">{formatMoney(book.navBase, book.baseCurrency)}</p>
      <p class="meta">
        {segmentName('cash')} {formatMoney(book.cashBase, book.baseCurrency)}
      </p>
      <Unrealized book={book} />
      <h3 class="sub-head">{tr('ui.office.book.holding')}</h3>
      <HoldingsList positions={heldPositions.value} />
      <h3 class="sub-head">{tr('ui.office.book.bySegment')}</h3>
      <SegmentBars shares={book.shares} />
    </>
  )
}
