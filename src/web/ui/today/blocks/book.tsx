import type { TradingPortfolioResponse } from '@/app/server/wire/trading'
import { pluralKey } from '@/i18n'
import { readBlock } from '@/web/state/block'
import { heldPositions, holdingsBlock, stopBreaches } from '@/web/state/market'
import { formatPrice, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { PieIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

const PERCENT = 100
// A money total prints whole units beside the wire's currency code.
const TOTAL_DISPLAY = Object.freeze({ divisor: 1, decimals: 0 })

/** "Danh mục của bạn": the book's total, what it holds and which names broke their stop. */
export function Book() {
  return (
    <BlockFrame
      title={tr('trading.brief.block.summary')}
      colour="green"
      icon={<PieIcon />}
      reading={readBlock(holdingsBlock)}
      dataTo={holdingsBlock.view.value.data?.asOf}
    >
      {(book) => <BookFigures book={book} />}
    </BlockFrame>
  )
}

function BookFigures({ book }: { readonly book: TradingPortfolioResponse }) {
  const held = heldPositions.value.length
  const breaches = stopBreaches.value.length

  if (held === 0) {
    return <p class="meta">{tr('ui.office.today.bookEmpty')}</p>
  }

  return (
    <>
      <p class="meta">{tr('ui.office.today.bookNav')}</p>
      <p class="big-figure">
        {formatPrice(book.navBase, TOTAL_DISPLAY)} {book.baseCurrency}
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

// Priced holdings only: an unpriced one adds to neither side, so the percent stays honest.
function Unrealized({ book }: { readonly book: TradingPortfolioResponse }) {
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
        {formatPrice(profit, TOTAL_DISPLAY)} ({formatSignedPercent(percent)})
      </b>
    </p>
  )
}
