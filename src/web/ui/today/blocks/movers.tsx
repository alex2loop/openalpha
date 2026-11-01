import type { OverviewMoversWire } from '@/app/server/wire/market'
import { formatCompactAmount } from '@/web/text/figures'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { RankedList, RankedLists } from '@/web/ui/market/ranked-list'
import { TickerLink } from '@/web/ui/ticker/ticker-link'

const MOVERS_SHOWN = 5

interface MoversProps {
  readonly movers: OverviewMoversWire | undefined
  readonly currency: string
}

/** A market's biggest gainers and losers beside each other; a list with no name is left out. */
export function Movers({ movers, currency }: MoversProps) {
  if (movers === undefined || (movers.gainers.length === 0 && movers.losers.length === 0)) {
    return null
  }

  const note = joinInline([
    ...(movers.window === 'rolling-24h' ? [tr('ui.office.today.window24h')] : []),
    tr('ui.office.market.amountsIn', { currency }),
  ])
  const rowsOf = (list: OverviewMoversWire['gainers']) =>
    list.slice(0, MOVERS_SHOWN).map((row) => ({
      key: row.instrument.ticker,
      label: <TickerLink ticker={row.instrument.ticker} market={row.instrument.market} />,
      figure: formatCompactAmount(row.turnover),
      changePct: row.changePct,
    }))

  return (
    <RankedLists>
      <RankedList title={tr('ui.office.today.gainers')} note={note} rows={rowsOf(movers.gainers)} />
      <RankedList title={tr('ui.office.today.losers')} note={note} rows={rowsOf(movers.losers)} />
    </RankedLists>
  )
}
