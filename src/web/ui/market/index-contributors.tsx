import type { IndexContributorsResponse } from '@/app/server/wire/index-reading'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { printDisplayOf } from '@/web/state/market'
import { formatFixed, formatPrice } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
import { TrendIcon } from '@/web/ui/kit/icons'
import { RankedList, RankedLists } from '@/web/ui/market/ranked-list'
import { TickerLink } from '@/web/ui/ticker/ticker-link'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** The daemon holds a list for about a minute while the session trades; asking at that pace keeps a
 *  tab left open current without the page ever being the one that spends a provider read. */
const CONTRIBUTORS_POLL_MS = 60_000
const POINT_DIGITS = 2

type Contributors = NonNullable<IndexContributorsResponse['contributors']>
type Contributor = Contributors['up'][number]

interface IndexContributorsProps {
  readonly market: string
  readonly index: { readonly code: string; readonly label: string }
}

/** Mã dẫn dắt chỉ số: the names that lifted and the names that weighed on the index this session.
 *  Nothing to show reads as no section; a failed read says why in the daemon's words. */
export function IndexContributors({ market, index }: IndexContributorsProps) {
  const reading = useBlock(ROUTES.indexContributors, {
    query: { market, index: index.code },
    everyMs: CONTRIBUTORS_POLL_MS,
  })
  const contributors = reading.data?.contributors

  if (reading.state === 'ready' && contributors === undefined) {
    return null
  }

  return (
    <BlockFrame
      title={tr('ui.office.market.contributors.title', { index: index.label })}
      colour="blue"
      icon={<TrendIcon />}
      reading={reading}
      dataTo={contributors?.asOf}
      showReadLine={false}
    >
      {(data) =>
        data.contributors !== undefined && <Sides market={market} {...data.contributors} />
      }
    </BlockFrame>
  )
}

function Sides({ market, ...sides }: Contributors & { readonly market: string }) {
  if (sides.up.length === 0 && sides.down.length === 0) {
    return null
  }

  return (
    <>
      <RankedLists>
        <RankedList
          title={tr('ui.office.market.contributors.up')}
          rows={sides.up.map((row) => toRankedRow(row, market))}
        />
        <RankedList
          title={tr('ui.office.market.contributors.down')}
          rows={sides.down.map((row) => toRankedRow(row, market))}
        />
      </RankedLists>
      <p class="meta">
        {tr('ui.office.market.contributors.sums', {
          upCount: sides.up.length,
          upSum: formatPoints(sides.upSum),
          downCount: sides.down.length,
          downSum: formatPoints(sides.downSum),
        })}
      </p>
    </>
  )
}

function toRankedRow(row: Contributor, market: string) {
  return {
    key: row.instrument.ticker,
    label: <TickerLink ticker={row.instrument.ticker} market={row.instrument.market} />,
    figure: formatPrice(row.price, printDisplayOf(market)),
    pill: {
      text: formatPoints(row.point),
      tone: row.point > 0 ? ('up' as const) : ('down' as const),
    },
  }
}

/** Index points with their sign, which is the whole of what the figure says. */
function formatPoints(points: number): string {
  return `${points > 0 ? '+' : ''}${formatFixed(points, POINT_DIGITS)}`
}
