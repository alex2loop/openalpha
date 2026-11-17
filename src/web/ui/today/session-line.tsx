import type { MarketSessionWire, MarketWire } from '@/app/server/wire/market'
import { DATE_ORDER_LOCALES, formatDay } from '@/i18n'
import { readBlock } from '@/web/state/block'
import { homeMarket, isTradingPhase, overviewBlock, selectOverview } from '@/web/state/market'
import { locale, state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatClock } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import { selectBoard } from '@/web/ui/today/blocks/market-section'

const WEEKDAY_PARTS: Intl.DateTimeFormatOptions = Object.freeze({
  weekday: 'long',
  timeZone: 'UTC',
})

type SessionHoursAt = NonNullable<MarketSessionWire['todayAt']>

type SessionClockKey =
  | 'ui.office.today.session.closesAt'
  | 'ui.office.today.session.reopensAt'
  | 'ui.office.today.session.opensAt'

interface SessionStatus {
  readonly status: string
  readonly detail?: string
}

/** The home market's day at a glance: the date, whether it trades now and until when, and when the
 *  prices below were read. Absent until the markets are read, or for a home that never closes. */
export function SessionLine() {
  const market = homeMarket()
  const session = market?.session

  if (market === undefined || session === undefined) {
    return null
  }

  const { status, detail } = statusOf(market, session)
  const priced = pricedText(session)

  return (
    <p class="meta session-line">
      {joinInline([formatWeekday(session.today), ''])}
      <b>{status}</b>
      {detail === undefined ? '' : `, ${detail}`}
      {priced === undefined ? '' : joinInline(['', priced])}
    </p>
  )
}

function statusOf(market: MarketWire, session: MarketSessionWire): SessionStatus {
  // The exchange that keeps the hours, else the market's own name.
  const name = { market: session.exchange ?? market.segmentLabel }
  const hours = session.todayAt

  switch (session.phase) {
    case 'open':
      return {
        status: tr('ui.office.today.session.open', name),
        ...detailAt('ui.office.today.session.closesAt', hours?.close),
      }
    case 'break':
      return {
        status: tr('ui.office.today.session.break', name),
        ...detailAt(
          'ui.office.today.session.reopensAt',
          hours === undefined ? undefined : breakEndOf(hours)
        ),
      }
    case 'pre-open':
      return {
        status: tr('ui.office.today.session.preOpen', name),
        ...detailAt('ui.office.today.session.opensAt', hours?.open),
      }
    case 'post-close':
      return { status: tr('ui.office.today.session.closed', name) }
    case 'non-session':
      return {
        status: tr('ui.office.today.session.dayOff', name),
        detail: tr('ui.office.today.session.next', {
          day: formatWeekday(session.nextTradingDay),
        }),
      }
  }
}

// The end of the break the market is in now: the first that has not ended.
function breakEndOf(hours: SessionHoursAt): number {
  const now = Date.now()
  const ends = (hours.breaks ?? []).map((pause) => pause.to)

  return ends.find((end) => end > now) ?? ends.at(-1) ?? hours.open
}

// A clock reads on the operator's zone; without the instant or the zone the line names no time.
function detailAt(key: SessionClockKey, at: number | undefined): { readonly detail?: string } {
  const time = operatorClock(at)

  return time === undefined ? {} : { detail: tr(key, { time }) }
}

function operatorClock(at: number | undefined): string | undefined {
  const timeZone = state.value?.timeZone

  return at === undefined || timeZone === undefined ? undefined : formatClock(at, timeZone)
}

// While it trades, the time the board was read; once it is closed, its closing prices.
function pricedText(session: MarketSessionWire): string | undefined {
  const board = selectBoard(selectOverview('home'))

  if (board === undefined) {
    return undefined
  }

  if (!isTradingPhase(session.phase)) {
    const time =
      board.asOf === session.today
        ? operatorClock(session.todayAt?.close)
        : formatDay(locale.value, board.asOf)

    return time === undefined ? undefined : tr('ui.office.today.session.closingPrices', { time })
  }

  const time = operatorClock(readBlock(overviewBlock).readAt)

  return time === undefined ? undefined : tr('ui.office.today.session.pricedAt', { time })
}

// `YYYY-MM-DD` as "Thứ Ba 27/10": both page languages read the day first.
function formatWeekday(day: string): string {
  const [, month = '', date = ''] = day.split('-')
  const weekday = new Intl.DateTimeFormat(DATE_ORDER_LOCALES[locale.value], WEEKDAY_PARTS)

  return tr('ui.office.today.session.day', {
    weekday: weekday.format(new Date(day)),
    day: date,
    month,
  })
}
