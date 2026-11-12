import type { OverviewResponse } from '@/app/server/wire/overview'
import type { DealerBoardWire } from '@/app/server/wire/quote-detail'
import { findMarket } from '@/web/state/market'
import { formatSignedCompactAmount, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { formatDealerBoard, formatMarketPrice } from '@/web/text/market-price'
import { tr } from '@/web/text/tr'
import { Term } from '@/web/ui/glossary/term'
import { MarketName } from '@/web/ui/market/market-name'
import { TickerLink } from '@/web/ui/ticker/ticker-link'
import { Movers } from '@/web/ui/today/blocks/movers'
import { Readings } from '@/web/ui/today/blocks/readings'

const ROWS_SHOWN = 5

type OverviewBlock = OverviewResponse['markets'][number]

/** Every market of a block, or its empty line. */
export function MarketSections({ blocks }: { readonly blocks: OverviewResponse['markets'] }) {
  if (blocks.length === 0) {
    return <p class="empty-note">{tr('ui.office.today.empty')}</p>
  }

  return blocks.map((block) => <MarketSection key={block.market} block={block} />)
}

/** One market's rows, movers, readings, breadth and foreign flow, as the overview reads them. */
function MarketSection({ block }: { readonly block: OverviewBlock }) {
  const market = findMarket(block.market)

  return (
    <div class="flow market-section">
      <h3 class="sub-head">
        <MarketName market={block.market} label={market?.label} />
      </h3>
      <MarketRows block={block} hasBoard={market?.hasBoard === true} />
      <Movers movers={block.movers} currency={block.currency} />
      {(block.breadth !== undefined || block.foreignNetValue !== undefined) && (
        <div class="stack meta">
          {block.breadth !== undefined && (
            <p>
              <Term id="breadth">{tr('ui.office.today.breadth')}</Term>:{' '}
              {tr('ui.office.today.breadthCounts', {
                up: block.breadth.advancers,
                down: block.breadth.decliners,
              })}
            </p>
          )}
          {block.foreignNetValue !== undefined && (
            <p>
              <Term id="foreign-net">{tr('ui.office.today.foreign')}</Term>:{' '}
              {formatSignedCompactAmount(block.foreignNetValue)} {block.currency}
            </p>
          )}
        </div>
      )}
      <Readings block={block} />
      {block.sources !== undefined && <p class="market-source">{block.sources}</p>}
    </div>
  )
}

// The market's first rows; a market that read none says so rather than leaving its name alone.
function MarketRows({
  block,
  hasBoard,
}: {
  readonly block: OverviewBlock
  readonly hasBoard: boolean
}) {
  if (block.rows.length === 0) {
    return <p class="empty-note">{tr('ui.office.today.empty')}</p>
  }

  return (
    <div class="row-list">
      {block.rows.slice(0, ROWS_SHOWN).map((row) => (
        <OverviewRow
          key={row.instrument.ticker}
          row={row}
          currency={block.priceCurrency}
          hasBoard={hasBoard}
        />
      ))}
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
  if (row.board !== undefined) {
    return <DealerRow row={row} board={row.board} />
  }

  // A level market (an index) has no price currency and prints its bare level.
  return (
    <div class="row">
      <b>
        <TickerLink ticker={row.instrument.ticker} market={row.instrument.market} />
      </b>
      <span class="row-price">
        {formatMarketPrice(row.instrument.market, row.price, { isLevel: currency === undefined })}
      </span>
      {hasBoard && (
        <span class={`pill is-${toneOfPercent(row.changePct)}`}>
          {formatSignedPercent(row.changePct)}
        </span>
      )}
    </div>
  )
}

// A dealer's row states both sides and the gap between them, not a last price and a move.
function DealerRow({
  row,
  board,
}: {
  readonly row: OverviewBlock['rows'][number]
  readonly board: DealerBoardWire
}) {
  const { sides, spread } = formatDealerBoard(row.instrument.market, board)

  return (
    <div class="row dealer-row">
      <b>
        <TickerLink ticker={row.instrument.ticker} market={row.instrument.market} />
      </b>
      <span class="row-price">{sides}</span>
      <span class="meta">{spread}</span>
    </div>
  )
}
