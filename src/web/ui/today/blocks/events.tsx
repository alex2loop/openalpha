import type { AbsolutePositionWire, MarketEventWire } from '@/app/server/wire/trading'
import { formatDay } from '@/i18n'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { findMarket, heldPositions, holdingsBlock, keyOf } from '@/web/state/market'
import { locale, state } from '@/web/state/session'
import { useRetryWhenKnown } from '@/web/state/use-retry-when-known'
import { buildDayKey } from '@/web/text/time'
import { shiftDay } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'
import { CalendarIcon } from '@/web/ui/kit/icons'
import { TickerLink } from '@/web/ui/ticker/ticker-link'
import { BlockFrame } from '@/web/ui/today/block-frame'

const EVENTS_WINDOW_DAYS = 14
const EVENTS_TICKERS_MAX = 8
const EVENTS_SHOWN = 8
const EVENTS_POLL_MS = 300_000

interface HeldEvent {
  readonly key: string
  readonly ticker: string
  readonly market: string
  readonly event: MarketEventWire
}

interface HeldEvents {
  readonly events: readonly HeldEvent[]
  /** Held names with an event source that were not read: only the largest are. */
  readonly leftOut: number
}

/** "Sự kiện sắp tới": ex-dates, meetings and listings of the names the operator holds. */
export function Events() {
  const reading = useBlockRead(loadEvents, {
    capability: ROUTES.events.capability,
    everyMs: EVENTS_POLL_MS,
  })
  const hasHoldings = holdingsBlock.view.value.readAt !== undefined

  // The first read may come before the book does.
  useRetryWhenKnown(hasHoldings, reading.retry)

  return (
    <BlockFrame
      title={tr('ui.office.today.events')}
      colour="blue"
      icon={<CalendarIcon />}
      reading={reading}
    >
      {(held) => <EventList held={held} />}
    </BlockFrame>
  )
}

function EventList({ held }: { readonly held: HeldEvents }) {
  const { events, leftOut } = held
  const note =
    leftOut === 0 ? null : (
      <p class="meta">{tr('ui.office.today.eventsLargestOnly', { count: EVENTS_TICKERS_MAX })}</p>
    )

  if (events.length === 0) {
    return (
      <>
        <p class="empty-note">{tr('ui.office.today.noEvents', { days: EVENTS_WINDOW_DAYS })}</p>
        {note}
      </>
    )
  }

  return (
    <div class="row-list">
      {events.map((entry) => (
        <div key={entry.key} class="row">
          <div>
            <b>
              <TickerLink ticker={entry.ticker} market={entry.market} />
            </b>{' '}
            {entry.event.title}
            {entry.event.detail !== undefined && <p class="meta">{entry.event.detail}</p>}
          </div>
          <span class="row-note">{formatDay(locale.value, entry.event.at)}</span>
        </div>
      ))}
      {note}
    </div>
  )
}

// Reads each held name that has an event source; one name failing leaves the rest, all failing fails.
async function loadEvents(abort: AbortSignal): Promise<HeldEvents> {
  const timeZone = state.value?.timeZone

  if (timeZone === undefined) {
    return { events: [], leftOut: 0 }
  }

  const fromDay = buildDayKey(Date.now(), timeZone)
  const toDay = shiftDay(fromDay, EVENTS_WINDOW_DAYS)
  const withEvents = heldPositions.value
    .filter((position) => findMarket(position.instrument.market)?.hasEvents === true)
    .sort((a, b) => rankValueOf(b) - rankValueOf(a))
  const targets = withEvents.slice(0, EVENTS_TICKERS_MAX).map((position) => position.instrument)
  const settled = await Promise.allSettled(
    targets.map((instrument) =>
      getJson(ROUTES.events, { query: { ...instrument, fromDay, toDay }, signal: abort })
    )
  )
  const failures = settled.flatMap((result) =>
    result.status === 'rejected' && result.reason instanceof ApiFailure ? [result.reason] : []
  )

  if (failures[0] !== undefined && failures.length === targets.length) {
    throw failures[0]
  }

  const events = settled
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    .flatMap((answer) =>
      answer.events.map((event) => ({
        key: `${keyOf(answer)}:${event.at}:${event.kind}`,
        ticker: answer.ticker,
        market: answer.market,
        event,
      }))
    )
    .filter((held) => held.event.at >= fromDay)
    .sort((a, b) => a.event.at.localeCompare(b.event.at))
    .slice(0, EVENTS_SHOWN)

  return { events, leftOut: withEvents.length - targets.length }
}

// An unpriced holding ranks by what it cost.
function rankValueOf(position: AbsolutePositionWire): number {
  return position.marketValueBase ?? position.investedBase
}
