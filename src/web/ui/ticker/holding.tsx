import type { StopsResponse } from '@/app/server/wire/money'
import type { AbsolutePositionWire, TradingPortfolioResponse } from '@/app/server/wire/trading'
import { formatDay } from '@/i18n'
import { readBlock } from '@/web/state/block'
import { heldPositions, holdingsBlock, keyOf, stopsBlock } from '@/web/state/market'
import { locale } from '@/web/state/session'
import {
  formatFixedFraction,
  formatPrice,
  formatQuantity,
  formatSignedPercent,
  PERCENT,
  toneOfPercent,
  WHOLE_DISPLAY,
} from '@/web/text/figures'
import { formatMarketPrice } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { toMovePercent } from '@/web/ui/book/unrealized'
import { PieIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

interface HoldingBlockProps {
  readonly ticker: string
  readonly market: string
}

/** "Đang giữ": what the operator holds of this name, or that they hold none. */
export function HoldingBlock({ ticker, market }: HoldingBlockProps) {
  return (
    <BlockFrame
      title={tr('ui.office.book.holding')}
      colour="green"
      icon={<PieIcon />}
      reading={readBlock(holdingsBlock)}
    >
      {(book) => <HoldingBody book={book} ticker={ticker} market={market} />}
    </BlockFrame>
  )
}

interface HoldingBodyProps extends HoldingBlockProps {
  readonly book: TradingPortfolioResponse
}

function HoldingBody({ book, ticker, market }: HoldingBodyProps) {
  const key = keyOf({ market, ticker })
  const position = heldPositions.value.find((held) => keyOf(held.instrument) === key)
  const stop = stopsBlock.view.value.data?.stops.find((row) => keyOf(row.instrument) === key)

  if (position === undefined) {
    return <p class="meta">{tr('ui.office.ticker.noHolding')}</p>
  }

  return <HoldingFacts position={position} stop={stop} currency={book.baseCurrency} />
}

interface HoldingFactsProps {
  readonly position: AbsolutePositionWire
  readonly stop: StopsResponse['stops'][number] | undefined
  readonly currency: string
}

function HoldingFacts({ position, stop, currency }: HoldingFactsProps) {
  const { market } = position.instrument
  const move = toMovePercent(position)
  const weight = position.weightPctNav === undefined ? undefined : position.weightPctNav / PERCENT

  return (
    <dl class="kv">
      <Fact label={tr('ui.office.ticker.quantity')} value={formatQuantity(position.quantity)} />
      <Fact
        label={tr('ui.office.ticker.cost')}
        value={formatMarketPrice(market, position.unitCostNative)}
      />
      {position.heldSince !== undefined && (
        <Fact
          label={tr('ui.office.ticker.since')}
          value={formatDay(locale.value, position.heldSince)}
        />
      )}
      <Fact
        label={tr('ui.office.book.pnl')}
        value={`${formatPrice(position.unrealizedPnlBase, WHOLE_DISPLAY)} ${currency}`}
        tone={toneOfPercent(move)}
        note={formatSignedPercent(move)}
      />
      <Fact label={tr('ui.office.ticker.weight')} value={formatFixedFraction(weight)} />
      {stop?.stop !== undefined && (
        <Fact
          label={tr(stop.review ? 'ui.office.ticker.review' : 'ui.office.ticker.stop')}
          value={formatMarketPrice(market, stop.stop)}
        />
      )}
    </dl>
  )
}

interface FactProps {
  readonly label: string
  readonly value: string
  readonly tone?: 'up' | 'down' | 'flat'
  readonly note?: string
}

function Fact({ label, value, tone, note }: FactProps) {
  return (
    <div>
      <dt>{label}</dt>
      <dd class={tone === undefined ? '' : `is-${tone}-text`}>
        {value}
        {note !== undefined && <span class="meta"> {note}</span>}
      </dd>
    </div>
  )
}
