import type { MarketSessionWire, MarketWire } from '@/app/server/wire/market'
import { DATE_ORDER_LOCALES, formatDay } from '@/i18n'
import { readBlock } from '@/web/state/block'
import {
  homeRegion,
  isTradingPhase,
  knownMarkets,
  overviewBlock,
  selectOverview,
} from '@/web/state/market'
import { locale, state } from '@/web/state/session'
import { joinInline } from '@/web/text/glyphs'
import { formatClock, zoneParts } from '@/web/text/time'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'
import { selectBoard } from '@/web/ui/today/blocks/market-section'

const WEEKDAY_PARTS: Intl.DateTimeFormatOptions = Object.freeze({
  weekday: 'long',
  timeZone: 'UTC',
})

interface SessionStatus {
  readonly status: string
  readonly detail?: string
}

/** The home market's day at a glance: the date, whether it trades now and until when, and when the
 *  prices below were read. Absent until the markets are read, or for a home that never closes. */
export function SessionLine() {
  const market = knownMarkets.value.find(
    (held) => held.region === homeRegion() && held.ownsRegion && held.session !== undefined
  )
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
  const name = { market: market.segmentLabel }

  switch (session.phase) {
    case 'open':
      return {
        status: tr('ui.office.today.session.open', name),
        detail: tr('ui.office.today.session.closesAt', { time: session.close }),
      }
    case 'break':
      return {
        status: tr('ui.office.today.session.break', name),
        detail: tr('ui.office.today.session.reopensAt', { time: breakEndOf(session) }),
      }
    case 'pre-open':
      return {
        status: tr('ui.office.today.session.preOpen', name),
        detail: tr('ui.office.today.session.opensAt', { time: session.open }),
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

// The break the market is in now: the first that has not ended on its clock.
function breakEndOf(session: MarketSessionWire): string {
  const now = zoneParts(Date.now(), session.timeZone).minute
  const ends = (session.breaks ?? []).map((pause) => pause.to)

  return ends.find((end) => toMinutes(end) > now) ?? ends.at(-1) ?? session.open
}

// While it trades, the time the board was read; once it is closed, its closing prices.
function pricedText(session: MarketSessionWire): string | undefined {
  const board = selectBoard(selectOverview('home'))
  const timeZone = state.value?.timeZone

  if (board === undefined) {
    return undefined
  }

  if (!isTradingPhase(session.phase)) {
    const time =
      board.asOf === session.today
        ? session.close
        : `${formatDay(locale.value, board.asOf)} ${session.close}`

    return tr('ui.office.today.session.closingPrices', { time })
  }

  const { readAt } = readBlock(overviewBlock)

  return readAt === undefined || timeZone === undefined
    ? undefined
    : tr('ui.office.today.session.pricedAt', { time: formatClock(readAt, timeZone) })
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

function toMinutes(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number)

  return hours * MINUTES_PER_HOUR + minutes
}
