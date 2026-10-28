import type { IndexContributorsResponse } from '@/app/server/wire/index-reading'
import { ROUTES } from '@/web/api/routes'
import { useBlock } from '@/web/state/block'
import { printDisplayOf } from '@/web/state/market'
import { formatFixed, formatPrice } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { TrendIcon } from '@/web/ui/kit/icons'
import { RankedList, RankedLists } from '@/web/ui/market/ranked-list'
import { TickerLink } from '@/web/ui/ticker/ticker-link'
import { BlockFrame } from '@/web/ui/today/block-frame'

/** The daemon holds a list for a minute from its read while the session trades, so a poll landing
 *  inside that minute, or a second tab asking, is answered without a provider read. */
const CONTRIBUTORS_POLL_MS = 60_000
const POINT_DIGITS = 2

type Contributors = NonNullable<IndexContributorsResponse['contributors']>
type Contributor = Contributors['up'][number]

interface IndexContributorsProps {
  readonly market: string
  readonly index: { readonly code: string; readonly label: string }
}

/** Mã dẫn dắt chỉ số: the names that lifted and the names that weighed on the index this session.
 *  A read with no list, whether it failed or answered without one, says why in the daemon's words. */
export function IndexContributors({ market, index }: IndexContributorsProps) {
  const reading = useBlock(ROUTES.indexContributors, {
    query: { market, index: index.code },
    everyMs: CONTRIBUTORS_POLL_MS,
  })
  const answer = reading.data
  const title = tr('ui.office.market.contributors.title', { index: index.label })
  const isWithoutList = answer !== undefined && answer.contributors === undefined

  return (
    <BlockFrame
      title={title}
      colour="blue"
      icon={<TrendIcon />}
      reading={isWithoutList ? { ...reading, state: 'failed', cautions: [] } : reading}
      dataTo={answer?.contributors?.asOf}
      failedText={isWithoutList ? withoutListText(title, answer.caveats) : undefined}
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

/** The daemon's own reason for answering without a list, whatever its severity. */
function withoutListText(title: string, caveats: IndexContributorsResponse['caveats']): string {
  return tr('ui.office.today.failedNone', {
    what: title,
    reason:
      caveats.length === 0
        ? tr('ui.office.error.generic')
        : joinInline(caveats.map((caveat) => caveat.text)),
  })
}

/** Index points with their sign, which is the whole of what the figure says. */
function formatPoints(points: number): string {
  return `${points > 0 ? '+' : ''}${formatFixed(points, POINT_DIGITS)}`
}
