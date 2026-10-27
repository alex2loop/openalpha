import type { OverviewResponse } from '@/app/server/wire/market'
import { findMarket, priceDisplayOf } from '@/web/state/market'
import { formatPrice, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { TickerLink } from '@/web/ui/ticker/ticker-link'

const ROWS_SHOWN = 5

type OverviewBlock = OverviewResponse['markets'][number]

/** Every market of a block, or its empty line. */
export function MarketSections({ blocks }: { readonly blocks: OverviewResponse['markets'] }) {
  if (blocks.length === 0) {
    return <p class="meta">{tr('ui.office.today.empty')}</p>
  }

  return blocks.map((block) => <MarketSection key={block.market} block={block} />)
}

/** One market's rows, breadth and foreign flow, as the overview reads them. */
function MarketSection({ block }: { readonly block: OverviewBlock }) {
  const market = findMarket(block.market)

  return (
    <div class="market-section">
      <h3 class="sub-head">{market?.label ?? block.market}</h3>
      <div class="row-list">
        {block.rows.slice(0, ROWS_SHOWN).map((row) => (
          <OverviewRow
            key={row.instrument.ticker}
            row={row}
            currency={block.priceCurrency}
            hasBoard={market?.hasBoard === true}
          />
        ))}
      </div>
      {block.breadth !== undefined && (
        <p class="meta">
          {tr('ui.office.today.breadth', {
            up: block.breadth.advancers,
            down: block.breadth.decliners,
          })}
        </p>
      )}
      {block.foreignNetText !== undefined && (
        <p class="meta">
          {tr('ui.office.today.foreign')}: {block.foreignNetText}
        </p>
      )}
    </div>
  )
}

/** The first block with a board: a dealer's rows (gold) state no closing price. */
export function selectBoard(blocks: OverviewResponse['markets']): OverviewBlock | undefined {
  return blocks.find((block) => findMarket(block.market)?.hasBoard === true)
}

interface OverviewRowProps {
  readonly row: OverviewBlock['rows'][number]
  readonly currency: string | undefined
  /** A dealer's rows (gold) state no closing price, so they carry no day move. */
  readonly hasBoard: boolean
}

function OverviewRow({ row, currency, hasBoard }: OverviewRowProps) {
  // A level market (an index) has no price currency and prints its bare level.
  const display = currency === undefined ? undefined : priceDisplayOf(row.instrument.market)
  const price = formatPrice(row.price, display)

  return (
    <div class="row">
      <b>
        <TickerLink ticker={row.instrument.ticker} market={row.instrument.market} />
      </b>
      <span class="row-price">
        {display === undefined && currency !== undefined ? `${price} ${currency}` : price}
      </span>
      {hasBoard && (
        <span class={`pill is-${toneOfPercent(row.changePct)}`}>
          {formatSignedPercent(row.changePct)}
        </span>
      )}
    </div>
  )
}
