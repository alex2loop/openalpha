import type { TradingPortfolioResponse } from '@/app/server/wire/trading'
import { pluralKey } from '@/i18n'
import { ROUTES } from '@/web/api/routes'
import { readBlock, useBlock } from '@/web/state/block'
import { openBook } from '@/web/state/book'
import { heldPositions, holdingsBlock, stopBreaches } from '@/web/state/market'
import { formatPrice, WHOLE_DISPLAY } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { EmptyBookActions } from '@/web/ui/book/empty-actions'
import { Unrealized } from '@/web/ui/book/unrealized'
import { Button } from '@/web/ui/kit/button'
import { PieIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

// A resting order changes when an exit is placed or fills, so a slow read keeps the line current.
const TARGETS_REFRESH_MS = 60_000

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
      <RestingTargets />
    </>
  )
}

/** "N lệnh chốt lời đang chờ ở sàn": the take-profit orders resting at an exchange under what you
 *  hold. Absent where the daemon places no orders, while unread, and at none. */
function RestingTargets() {
  const reading = useBlock(ROUTES.trade, { everyMs: TARGETS_REFRESH_MS })
  const resting = reading.data?.exits.filter((exit) => exit.takeProfit !== undefined).length ?? 0

  if (resting === 0) {
    return null
  }

  return (
    <p class="meta">
      {tr(pluralKey(resting, 'ui.office.today.bookTargetsOne', 'ui.office.today.bookTargets'), {
        count: resting,
      })}
    </p>
  )
}
