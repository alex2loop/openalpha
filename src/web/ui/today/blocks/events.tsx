import { useEffect } from 'preact/hooks'

import type { MarketEventWire } from '@/app/server/wire/trading'
import { formatDay } from '@/i18n'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { findMarket, heldPositions, holdingsBlock, keyOf } from '@/web/state/market'
import { locale, state } from '@/web/state/session'
import { buildDayKey, shiftDay } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { CalendarIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

const EVENTS_WINDOW_DAYS = 14
const EVENTS_TICKERS_MAX = 8
const EVENTS_SHOWN = 8
const EVENTS_POLL_MS = 300_000

interface HeldEvent {
  readonly key: string
  readonly ticker: string
  readonly event: MarketEventWire
}

/** "Sự kiện sắp tới": ex-dates, meetings and listings of the names the operator holds. */
export function Events() {
  const reading = useBlockRead(loadEvents, {
    capability: ROUTES.events.capability,
    everyMs: EVENTS_POLL_MS,
  })
  const hasHoldings = holdingsBlock.view.value.readAt !== undefined

  // The first read may come before the book does: read again once the book is there.
  useEffect(() => {
    if (hasHoldings) {
      reading.retry()
    }
  }, [hasHoldings])

  return (
    <BlockFrame
      title={tr('ui.office.today.events')}
      colour="blue"
      icon={<CalendarIcon />}
      reading={reading}
    >
      {(events) => <EventList events={events} />}
    </BlockFrame>
  )
}

function EventList({ events }: { readonly events: readonly HeldEvent[] }) {
  if (events.length === 0) {
    return <p class="meta">{tr('ui.office.today.empty')}</p>
  }

  return (
    <div class="row-list">
      {events.map((held) => (
        <div key={held.key} class="row">
          <div>
            <b>{held.ticker}</b> {held.event.title}
            {held.event.detail !== undefined && <p class="meta">{held.event.detail}</p>}
          </div>
          <span class="row-note">{formatDay(locale.value, held.event.at)}</span>
        </div>
      ))}
    </div>
  )
}

// Reads each held name that has an event source; one name failing leaves the rest, all failing fails.
async function loadEvents(abort: AbortSignal): Promise<readonly HeldEvent[]> {
  const timeZone = state.value?.timeZone

  if (timeZone === undefined) {
    return []
  }

  const fromDay = buildDayKey(Date.now(), timeZone)
  const toDay = shiftDay(fromDay, EVENTS_WINDOW_DAYS)
  const targets = heldPositions.value
    .map((position) => position.instrument)
    .filter((instrument) => findMarket(instrument.market)?.hasEvents === true)
    .slice(0, EVENTS_TICKERS_MAX)
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

  return settled
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    .flatMap((answer) =>
      answer.events.map((event) => ({
        key: `${keyOf(answer)}:${event.at}:${event.kind}`,
        ticker: answer.ticker,
        event,
      }))
    )
    .filter((held) => held.event.at >= fromDay)
    .sort((a, b) => a.event.at.localeCompare(b.event.at))
    .slice(0, EVENTS_SHOWN)
}
