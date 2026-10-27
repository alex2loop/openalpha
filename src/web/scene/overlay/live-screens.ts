import type { LitScreen } from '@/web/scene/overlay/screens'
import type { ActorId, DeskItemsView } from '@/web/scene/types'
import { alertCounts } from '@/web/scene/data/room-status'
import { screenRectOf } from '@/web/scene/overlay/screens'
import { rosterDefOf } from '@/web/scene/sim/actors/roster'
import { isSeatedIdle } from '@/web/scene/sim/life/desk-live'
import { formatSignedPercent } from '@/web/text/figures'
import { tr } from '@/web/text/tr'

const ANALYST: ActorId = 'analyst'
const CLERK: ActorId = 'clerk'
const ALERTS_LINE_ID = 'alerts'

/** The hand-off with the idle desks' readings added to its lit screens: the analyst's laptop draws
 *  the watched name its desk turns to, the alert clerk's computer the active alerts. */
export function withLiveScreens<T extends { readonly deskScreens: readonly LitScreen[] }>(
  handOff: T,
  desks: DeskItemsView
): T {
  const live = [analystScreen(desks), clerkScreen(desks)].flatMap((screen) =>
    screen === undefined ? [] : [screen]
  )

  return live.length === 0
    ? handOff
    : { ...handOff, deskScreens: [...handOff.deskScreens, ...live] }
}

function analystScreen(desks: DeskItemsView): LitScreen | undefined {
  const quote = desks.quotes.get(ANALYST)
  const move = quote === undefined ? '' : formatSignedPercent(quote.changePct)

  return quote === undefined
    ? undefined
    : screenOf(ANALYST, {
        kind: 'line',
        closes: quote.line,
        ticker: quote.ticker,
        market: quote.market,
        label: `${quote.ticker} ${move}`,
        hover: `${quote.label} ${move}`,
      })
}

function clerkScreen(desks: DeskItemsView): LitScreen | undefined {
  const count = alertCounts.value.alerts

  if (count === undefined || !isSeatedIdle(desks.monitors.get(CLERK))) {
    return undefined
  }

  const text = tr('ui.office.screen.alerts', { count })

  return screenOf(CLERK, {
    kind: 'tally',
    title: tr('ui.office.screen.alertsTitle'),
    lines: [{ kind: 'done', id: `${ALERTS_LINE_ID}:${count}`, text }],
  })
}

function screenOf(actor: ActorId, content: LitScreen['content']): LitScreen | undefined {
  const def = rosterDefOf(actor)
  const rect = def === undefined ? undefined : screenRectOf(def)

  return def === undefined || rect === undefined
    ? undefined
    : { actor, floor: def.floor, room: def.room, rect, seat: def.seat.at, content }
}
