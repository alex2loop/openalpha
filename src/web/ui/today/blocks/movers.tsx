import type { OverviewMoversWire, OverviewMoverWire } from '@/app/server/wire/market'
import type { MessageKey } from '@/i18n'
import { formatAmount, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'
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

  const { window } = movers

  return (
    <div class="movers">
      <MoverList
        title="ui.office.today.gainers"
        window={window}
        rows={movers.gainers}
        currency={currency}
      />
      <MoverList
        title="ui.office.today.losers"
        window={window}
        rows={movers.losers}
        currency={currency}
      />
    </div>
  )
}

interface MoverListProps {
  readonly title: MessageKey
  readonly window: OverviewMoversWire['window']
  readonly rows: readonly OverviewMoverWire[]
  readonly currency: string
}

function MoverList({ title, window, rows, currency }: MoverListProps) {
  if (rows.length === 0) {
    return null
  }

  return (
    <div class="flow">
      <h4 class="sub-head">
        {tr(title)}
        {window === 'rolling-24h' && <span class="meta"> {tr('ui.office.today.window24h')}</span>}
      </h4>
      <div class="row-list">
        {rows.slice(0, MOVERS_SHOWN).map((row) => (
          <div key={row.instrument.ticker} class="row">
            <b>
              <TickerLink ticker={row.instrument.ticker} market={row.instrument.market} />
            </b>
            <span class="meta">
              {formatAmount(row.turnover)} {currency}
            </span>
            <span class={`pill is-${toneOfPercent(row.changePct)}`}>
              {formatSignedPercent(row.changePct)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
