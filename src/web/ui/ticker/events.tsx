import type { MarketEventWire } from '@/app/server/wire/trading'
import { formatDay } from '@/i18n'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { useBlockRead } from '@/web/state/block'
import { findMarket } from '@/web/state/market'
import { locale, state } from '@/web/state/session'
import { buildDayKey, shiftDay } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { CalendarIcon } from '@/web/ui/kit/icons'
import { BlockFrame } from '@/web/ui/today/block-frame'

// A name's card looks further ahead than the day's list does.
const EVENTS_WINDOW_DAYS = 45

interface EventsRead {
  readonly events: readonly MarketEventWire[]
}

/** "Sự kiện": the ex-dates, meetings and listings ahead of this name; absent when there are none. */
export function EventsBlock({
  ticker,
  market,
}: {
  readonly ticker: string
  readonly market: string
}) {
  const reading = useBlockRead(readEvents(ticker, market), { capability: ROUTES.events.capability })

  if (findMarket(market)?.hasEvents !== true || reading.data?.events.length === 0) {
    return null
  }

  return (
    <BlockFrame
      title={tr('ui.office.ticker.events')}
      colour="blue"
      icon={<CalendarIcon />}
      reading={reading}
    >
      {({ events }) => (
        <div class="row-list">
          {events.map((event) => (
            <div key={`${event.at}:${event.kind}`} class="row">
              <div>
                <b>{event.title}</b>
                {event.detail !== undefined && <p class="meta">{event.detail}</p>}
              </div>
              <span class="row-note">{formatDay(locale.value, event.at)}</span>
            </div>
          ))}
        </div>
      )}
    </BlockFrame>
  )
}

function readEvents(ticker: string, market: string): (abort: AbortSignal) => Promise<EventsRead> {
  return async (abort) => {
    const timeZone = state.value?.timeZone

    if (timeZone === undefined) {
      return { events: [] }
    }

    const fromDay = buildDayKey(Date.now(), timeZone)
    const answer = await getJson(ROUTES.events, {
      query: { market, ticker, fromDay, toDay: shiftDay(fromDay, EVENTS_WINDOW_DAYS) },
      signal: abort,
    })

    return { events: answer.events.filter((event) => event.at >= fromDay) }
  }
}
