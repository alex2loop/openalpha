import type { TradingPortfolioResponse } from '@/app/server/wire/trading'
import { pluralKey } from '@/i18n'
import { readBlock } from '@/web/state/block'
import { openBook } from '@/web/state/book'
import { heldPositions, holdingsBlock, stopBreaches } from '@/web/state/market'
import { formatPrice, WHOLE_DISPLAY } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { EmptyBookActions } from '@/web/ui/book/empty-actions'
import { Unrealized } from '@/web/ui/book/unrealized'
import { Button } from '@/web/ui/kit/button'
import { PieIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** "Danh mục của bạn hôm nay": the book's total, what it holds and which names broke their stop. */
export function Book() {
  return (
    <BlockFrame
      title={tr('ui.office.today.book')}
      colour="green"
      icon={<PieIcon />}
      reading={readBlock(holdingsBlock)}
      dataTo={holdingsBlock.view.value.data?.asOf}
      action={
        <Button kind="tertiary" size="small" onClick={() => openBook('overview')}>
          {tr('ui.office.common.seeBook')}
        </Button>
      }
    >
      {(book) => <BookFigures book={book} />}
    </BlockFrame>
  )
}

function BookFigures({ book }: { readonly book: TradingPortfolioResponse }) {
  const held = heldPositions.value.length
  const breaches = stopBreaches.value.length

  if (held === 0) {
    return (
      <>
        <p class="meta">{tr('ui.office.today.bookEmpty')}</p>
        <EmptyBookActions />
      </>
    )
  }

  return (
    <>
      <p class="meta">{tr('ui.office.today.bookNav')}</p>
      <p class="big-figure">
        {formatPrice(book.navBase, WHOLE_DISPLAY)} {book.baseCurrency}
      </p>
      <Unrealized book={book} />
      <p class="meta">
        {tr(pluralKey(held, 'ui.office.today.bookHeldOne', 'ui.office.today.bookHeld'), {
          count: held,
        })}
      </p>
      {breaches > 0 && (
        <p class="meta is-down-text">
          {tr(
            pluralKey(
              breaches,
              'ui.office.today.needsBreachesOne',
              'ui.office.today.needsBreaches'
            ),
            {
              count: breaches,
            }
          )}
        </p>
      )}
    </>
  )
}
