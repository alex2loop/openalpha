import type { OverviewLeadersWire, OverviewResponse } from '@/app/server/wire/market'
import { formatDay, type MessageKey } from '@/i18n'
import { findMarket, selectRegionOverview } from '@/web/state/market'
import { locale } from '@/web/state/session'
import { formatCompactAmount, formatSignedCompactAmount } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { CoinIcon } from '@/web/ui/kit/icons'
import { RankedList, RankedLists } from '@/web/ui/market/ranked-list'
import { TickerLink } from '@/web/ui/ticker/ticker-link'
import { BlockHead } from '@/web/ui/today/block-frame'

const LEADERS_SHOWN = 5

type LeaderList = Exclude<keyof OverviewLeadersWire, 'window' | 'sessions' | 'proprietaryDay'>

// Reading order: who bought, who sold, then the money that changed hands. A net list is signed.
const LEADER_LISTS = Object.freeze([
  { list: 'foreignBuys', title: 'ui.office.market.foreignBuys', isNet: true },
  { list: 'foreignSells', title: 'ui.office.market.foreignSells', isNet: true },
  {
    list: 'proprietaryBuys',
    title: 'ui.office.market.proprietaryBuys',
    isNet: true,
  },
  {
    list: 'proprietarySells',
    title: 'ui.office.market.proprietarySells',
    isNet: true,
  },
  { list: 'mostTraded', title: 'ui.office.market.mostTraded', isNet: false },
] as const satisfies readonly {
  readonly list: LeaderList
  readonly title: MessageKey
  readonly isNet: boolean
}[])

// The desk's lists can come from an earlier session than the rest, so they are dated on their own.
const PROPRIETARY_LISTS: ReadonlySet<LeaderList> = new Set(['proprietaryBuys', 'proprietarySells'])

type OverviewBlock = OverviewResponse['markets'][number]

/** Where the region's money went, by name: the foreign and proprietary desks' biggest net buys and
 *  sells and the most traded, from the overview already read. A market that measures none leaves the
 *  block out. */
export function Flows({ region }: { readonly region: string }) {
  const blocks = selectRegionOverview(region).filter((block) => block.leaders !== undefined)

  if (blocks.length === 0) {
    return null
  }

  return (
    <section class="block">
      <BlockHead title={tr('ui.office.market.flows')} colour="teal" icon={<CoinIcon />} />
      <div class="flow">
        {blocks.map((block) => (
          <MarketFlows key={block.market} block={block} />
        ))}
      </div>
    </section>
  )
}

function MarketFlows({ block }: { readonly block: OverviewBlock }) {
  const { leaders } = block

  if (leaders === undefined) {
    return null
  }

  const note = joinInline([...windowNotes(leaders), block.currency])
  const proprietaryNote = joinInline([...proprietaryDayNotes(leaders), note])

  return (
    <div class="flow">
      <h3 class="sub-head">{findMarket(block.market)?.label ?? block.market}</h3>
      <RankedLists>
        {LEADER_LISTS.map(({ list, title, isNet }) => (
          <RankedList
            key={list}
            title={tr(title)}
            note={PROPRIETARY_LISTS.has(list) ? proprietaryNote : note}
            rows={(leaders[list] ?? []).slice(0, LEADERS_SHOWN).map((leader) => ({
              key: leader.instrument.ticker,
              label: (
                <TickerLink ticker={leader.instrument.ticker} market={leader.instrument.market} />
              ),
              figure: (isNet ? formatSignedCompactAmount : formatCompactAmount)(leader.value),
              changePct: leader.changePct,
            }))}
          />
        ))}
      </RankedLists>
    </div>
  )
}

// Desk figures published after the session's own are dated, so an older session is never read as it.
function proprietaryDayNotes(leaders: OverviewLeadersWire): readonly string[] {
  return leaders.proprietaryDay === undefined
    ? []
    : [
        tr('ui.office.market.proprietaryDay', {
          day: formatDay(locale.value, leaders.proprietaryDay),
        }),
      ]
}

// A rolling day is said as such; one session is the default reading, several are counted.
function windowNotes(leaders: OverviewLeadersWire): readonly string[] {
  if (leaders.window === 'rolling-24h') {
    return [tr('ui.office.today.window24h')]
  }

  return leaders.sessions !== undefined && leaders.sessions > 1
    ? [tr('ui.office.market.windowSessions', { count: leaders.sessions })]
    : []
}
