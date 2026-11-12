import type { SectorsResponse } from '@/app/server/wire/market'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { editionKey, isAnalysisOnly } from '@/web/state/edition'
import { findMarket, selectRegionOverview } from '@/web/state/market'
import { useRereadAfterRefresh } from '@/web/state/refresh'
import { locale } from '@/web/state/session'
import { formatSignedFixedFraction, PERCENT } from '@/web/text/figures'
import { sectorName } from '@/web/text/segment'
import { tr } from '@/web/text/tr'
import { PieIcon } from '@/web/ui/kit/icons'
import { RankedList, type RankedRow } from '@/web/ui/market/ranked-list'
import { BlockFrame } from '@/web/ui/today/block-frame'

// The windows of the two excess returns the wire carries, in sessions.
const EXCESS_SHORT_SESSIONS = 20
const EXCESS_LONG_SESSIONS = 60

/** The sector table of each market of the region that files sectors: strongest first, and on the
 *  web edition by name with the excess returns over the index, which rank nothing. */
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
  if (isAnalysisOnly.value) {
    return <SectorList rows={byName(sectors).map(excessRow)} />
  }

  return <SectorList rows={sectors.map(sectorRow)} />
}

function SectorList({ rows }: { readonly rows: readonly RankedRow[] }) {
  return (
    <RankedList
      title={tr(editionKey('ui.office.market.sectorsRanked', 'ui.office.market.sectorsByName'))}
      note={tr(editionKey('ui.office.market.sectorsNote', 'ui.office.market.sectorsExcessNote'), {
        shortSessions: EXCESS_SHORT_SESSIONS,
        longSessions: EXCESS_LONG_SESSIONS,
      })}
      rows={rows}
    />
  )
}

function sectorRow(entry: SectorsResponse['sectors'][number]): RankedRow {
  return {
    key: entry.sector,
    label: sectorName(entry.sector),
    figure: entry.score === undefined ? '' : formatSignedFixedFraction(entry.score),
    changePct: entry.sessionReturn === undefined ? undefined : entry.sessionReturn * PERCENT,
  }
}

function byName(sectors: SectorsResponse['sectors']): SectorsResponse['sectors'] {
  return [...sectors].sort((a, b) =>
    sectorName(a.sector).localeCompare(sectorName(b.sector), locale.value)
  )
}

function excessRow(entry: SectorsResponse['sectors'][number]): RankedRow {
  return {
    ...sectorRow(entry),
    figure: tr('ui.office.market.sectorsExcess', {
      short: formatSignedFixedFraction(entry.excessReturnShort),
      shortSessions: EXCESS_SHORT_SESSIONS,
      long: formatSignedFixedFraction(entry.excessReturnLong),
      longSessions: EXCESS_LONG_SESSIONS,
    }),
  }
}
