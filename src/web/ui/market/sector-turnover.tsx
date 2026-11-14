import type { OverviewResponse, OverviewSectorTurnoverWire } from '@/app/server/wire/overview'
import { findMarket, overviewBlock, selectRegionOverview } from '@/web/state/market'
import { formatCompactAmount, formatFraction, formatMultiple } from '@/web/text/figures'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'
import { CoinIcon } from '@/web/ui/kit/icons'
import { MarketName } from '@/web/ui/market/market-name'
import { RankedList, type RankedRow } from '@/web/ui/market/ranked-list'
import { BlockHead, ReadLine } from '@/web/ui/today/block-frame'

type OverviewBlock = OverviewResponse['markets'][number]

/** Where the market's money traded on its latest session, by sector: each one's traded value, its
 *  share of the session and how busy it was against its own recent sessions. A market that does not
 *  measure it leaves the block out. */
export function SectorTurnover({ region }: { readonly region: string }) {
  const blocks = selectRegionOverview(region).filter((block) => block.sectorTurnover !== undefined)

  if (blocks.length === 0) {
    return null
  }

  const days = new Set(blocks.map((block) => block.asOf))

  return (
    <section class="block">
      <BlockHead
        title={tr('trading.brief.section.sector-turnover')}
        colour="teal"
        icon={<CoinIcon />}
      />
      <div class="flow">
        <ReadLine
          readAt={overviewBlock.view.value.readAt}
          dataTo={days.size === 1 ? blocks[0]?.asOf : undefined}
        />
        {blocks.map((block) => (
          <MarketSectorTurnover key={block.market} block={block} />
        ))}
      </div>
    </section>
  )
}

function MarketSectorTurnover({ block }: { readonly block: OverviewBlock }) {
  return (
    <div class="flow">
      <h3 class="sub-head">
        <MarketName market={block.market} label={findMarket(block.market)?.label} />
      </h3>
      <RankedList
        title={tr('ui.office.market.amountsIn', { currency: block.currency })}
        rows={(block.sectorTurnover ?? []).map(toRow)}
      />
    </div>
  )
}

function toRow(entry: OverviewSectorTurnoverWire): RankedRow {
  const figures = {
    turnover: formatCompactAmount(entry.turnover),
    share: formatFraction(entry.sharePct),
  }

  return {
    key: entry.sector,
    label: sectorName(entry.sector),
    figure:
      entry.turnoverRatio === undefined || entry.sessions === undefined
        ? tr('ui.office.market.sectorTurnoverFigureNoRatio', figures)
        : tr('ui.office.market.sectorTurnoverFigure', {
            ...figures,
            ratio: formatMultiple(entry.turnoverRatio),
            sessions: entry.sessions,
          }),
  }
}
