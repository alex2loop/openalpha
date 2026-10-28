import type { SectorsResponse } from '@/app/server/wire/market'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { findMarket, selectRegionOverview } from '@/web/state/market'
import { useRereadAfterRefresh } from '@/web/state/refresh'
import { formatSignedFraction, PERCENT } from '@/web/text/figures'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'
import { Fold } from '@/web/ui/kit/fold'
import { PieIcon } from '@/web/ui/kit/icons'
import { RankedList, type RankedRow } from '@/web/ui/market/ranked-list'
import { BlockFrame } from '@/web/ui/today/block-frame'

// The strongest and the weakest sectors shown before the rest fold away.
const SECTORS_PER_END = 5

/** The sector table of each market of the region that files sectors, strongest first. */
export function Sectors({ region }: { readonly region: string }) {
  const markets = selectRegionOverview(region)
    .map((block) => block.market)
    .filter((market) => findMarket(market)?.hasBoard === true)

  return markets.map((market) => <MarketSectors key={market} market={market} />)
}

function MarketSectors({ market }: { readonly market: string }) {
  const reading = useBlock(ROUTES.sectors, { query: { market } })

  useRereadAfterRefresh(reading.retry)

  // A market that files no sectors answers an empty table: nothing to show, nothing to fail.
  if (reading.data?.sectors.length === 0) {
    return null
  }

  return (
    <BlockFrame
      title={tr('ui.office.market.sectors')}
      colour="peach"
      icon={<PieIcon />}
      reading={reading}
      dataTo={reading.data?.asOf}
    >
      {(answer) => <SectorTable sectors={answer.sectors} />}
    </BlockFrame>
  )
}

function SectorTable({ sectors }: { readonly sectors: SectorsResponse['sectors'] }) {
  const rows = sectors.map(sectorRow)

  if (rows.length <= 2 * SECTORS_PER_END) {
    return <SectorList rows={rows} />
  }

  return (
    <>
      <SectorList rows={[...rows.slice(0, SECTORS_PER_END), ...rows.slice(-SECTORS_PER_END)]} />
      <Fold title={tr('ui.office.market.sectorsShowAll')}>
        <SectorList rows={rows} />
      </Fold>
    </>
  )
}

function SectorList({ rows }: { readonly rows: readonly RankedRow[] }) {
  return (
    <RankedList
      title={tr('ui.office.market.sectorsRanked')}
      note={tr('ui.office.market.sectorsNote')}
      rows={rows}
    />
  )
}

function sectorRow(entry: SectorsResponse['sectors'][number]): RankedRow {
  return {
    key: entry.sector,
    label: sectorName(entry.sector),
    figure: entry.score === undefined ? '' : formatSignedFraction(entry.score),
    changePct: entry.sessionReturn === undefined ? undefined : entry.sessionReturn * PERCENT,
  }
}
