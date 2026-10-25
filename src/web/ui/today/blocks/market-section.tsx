import type { OverviewResponse } from '@/app/server/wire/market'
import { findMarket, priceDisplayOf } from '@/web/state/market'
import { formatPrice, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'

const ROWS_SHOWN = 5
// A market still trading prints no close note; every other phase shows the last close.
const TRADING_PHASES: ReadonlySet<string> = new Set(['open', 'break'])

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
      <p class="market-name">{market?.label ?? block.market}</p>
      <div class="row-list">
        {block.rows.slice(0, ROWS_SHOWN).map((row) => (
          <OverviewRow key={row.instrument.ticker} row={row} currency={block.priceCurrency} />
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

/** "Giá đóng cửa {time}" while the market is not trading; absent for one that never closes. */
export function closeNoteOf(block: OverviewBlock | undefined): string | undefined {
  const session = block === undefined ? undefined : findMarket(block.market)?.session

  if (session === undefined || TRADING_PHASES.has(session.phase)) {
    return undefined
  }

  return tr('ui.office.today.closeNote', { time: session.close })
}

interface OverviewRowProps {
  readonly row: OverviewBlock['rows'][number]
  readonly currency: string | undefined
}

function OverviewRow({ row, currency }: OverviewRowProps) {
  const display = priceDisplayOf(row.instrument.market)
  const price = formatPrice(row.price, display)

  return (
    <div class="row">
      <b>{row.instrument.ticker}</b>
      <span>
        {display === undefined && currency !== undefined ? `${price} ${currency}` : price}
      </span>
      <span class={`pill is-${toneOfPercent(row.changePct)}`}>
        {formatSignedPercent(row.changePct)}
      </span>
    </div>
  )
}
