import type { CalendarPolicy, MarketConfig, SessionHours } from '@/trading/kernel/config'
import type { SessionPhase, TradingDay, TradingSessionState } from '@/trading/kernel/instrument'
import type { TradingCalendar } from '@/trading/markets/types'
import { ConfigError } from '@/core/errors'
import { LOCAL_TIME_RE, MS_PER_DAY, MS_PER_MINUTE, MS_PER_SECOND } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'
import { createRuleClosures } from '@/trading/markets/rule-closures'
import { cachedFormatter } from '@/trading/render/datetime'
import { dayFromEpochSeconds } from '@/trading/sources/rows/normalization'

const MINUTES_PER_HOUR = 60
/** A policy whose weekends swallow more than a decade of calendar days in a row is malformed;
 *  walking it forever would hang the caller instead of naming the bad policy. */
const MAXIMUM_DAYS_WITHOUT_SESSION = 3_650
/** How long after the bell a board needs to publish its closing auction. The session ends when
 *  trading stops; the day's figures stop changing only once that print lands, and a tape read in
 *  between is missing it while looking complete — HOSE read at the bell gave 18 of its 25 busiest
 *  names a wrong close. Deliberately generous, because the two errors are not symmetric: too long
 *  and a read reports the previous session, which is true; too short and it reports this one, which
 *  is not. */
const TAPE_SETTLE_LAG_MS = 1_800_000
/** The longest an open tape read here can legitimately go without printing: the CME metals halt,
 *  an hour each session, which the continuous calendar models as no break at all. A VN lunch break
 *  is longer and is exempted by session phase instead, so it does not have to fit in here. */
const QUIET_TAPE_MS = 60 * MS_PER_MINUTE
/** The oldest a reading may be and still be the price the market is making. Built from the two
 *  windows a legitimate reading can sit in rather than picked: a genuine closing print is already
 *  `TAPE_SETTLE_LAG_MS` old by the instant its session settles, and a quiet tape adds its halt on
 *  top. Past the sum is a feed that stopped advancing - the failure measured 2026-09-16 was four
 *  hours, which this clears by more than double, while the widest honest lag is an hour and a
 *  half. */
const MAXIMUM_OBSERVATION_AGE_MS = TAPE_SETTLE_LAG_MS + QUIET_TAPE_MS

/** What a reader calls the market's current state. Distinct from `TradingSessionState`, which is a
 *  protocol union other code switches on and reports the same `closed` for a lunch break and a
 *  weekend. */
// Intl formatter construction is expensive and the timezone cardinality is bounded by the
// registered markets' calendars, so formatters are kept per zone for the process lifetime.
/** These stamps are read by the model and by this file's own arithmetic, never rendered to the
 *  operator, so they take a fixed ISO-ordered locale rather than `[locale] language`. */
const MACHINE_LOCALE = 'en-CA'
const ZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>()
const TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>()

/** Crypto and the FX tape trade every day of the week; their calendar day is UTC, not any
 *  exchange's local day. Every `asOf`/cooldown computation for such a market resolves against this
 *  policy. It closes an hour or so after the FX roll, so a day it calls unsettled may just have
 *  settled — the error is one of caution, and only ever for that hour. World gold keeps UTC but
 *  declares its weekend (`WORLD_GOLD_CALENDAR`). */
export const CONTINUOUS_CALENDAR: CalendarPolicy = Object.freeze({
  timezone: 'UTC',
  sessionOpenLocalTime: '00:00',
  sessionCloseLocalTime: '23:59',
  weekendDays: Object.freeze([]),
  continuous: true,
})

interface SessionMinutes {
  readonly open: number
  readonly close: number
  readonly breakStart?: number
  readonly breakEnd?: number
}

/** The closures the operator declared under `[trading.markets.<id>]` lay over the market's own
 *  rules: `holidays` close a day the rules leave open, `openDays` reopen one they close, and the
 *  operator wins. */
export function createTradingCalendar(
  policy: CalendarPolicy,
  settings?: Pick<MarketConfig, 'holidays' | 'openDays'>
): TradingCalendar {
  const session = resolveSession(policy)
  const weekend: ReadonlySet<number> = new Set(policy.weekendDays)
  const holidays: ReadonlySet<TradingDay> = new Set(settings?.holidays)
  const openDays: ReadonlySet<TradingDay> = new Set(settings?.openDays)
  const isWeekend = (day: TradingDay): boolean => weekend.has(dayOfWeek(day))
  const ruleClosesDay = createRuleClosures(policy, isWeekend)
  // The rules are the forward answer; which past days the exchange was actually shut is still
  // answered by the bars themselves - see `advanceObservedSessions`.
  const isTradingDay = (day: TradingDay): boolean =>
    !(isWeekend(day) || holidays.has(day)) && (openDays.has(day) || !ruleClosesDay(day))
  const sessionCloseAt = (day: TradingDay): number =>
    zonedEpochMs(day, session.close, policy.timezone)

  return {
    timezone: policy.timezone,
    continuous: policy.continuous,
    ...(policy.continuous ? {} : { hours: toSessionHours(policy) }),
    isTradingDay,
    dayAt: (epochMs) => dayFromEpochSeconds(epochMs / MS_PER_SECOND, policy.timezone),
    addTradingDays: (day, count) => addTradingDays(day, count, isTradingDay),
    sessionOpenAt: (day) => zonedEpochMs(day, session.open, policy.timezone),
    sessionCloseAt,
    tapeFinalAt: (day) => sessionCloseAt(day) + TAPE_SETTLE_LAG_MS,
    sessionState: (epochMs) => resolveSessionState({ epochMs, policy, session, isTradingDay }),
  }
}

function toSessionHours(policy: CalendarPolicy): SessionHours {
  const { breakStartLocalTime: from, breakEndLocalTime: to } = policy
  const auctionFrom = policy.closeAuctionStartLocalTime
  const close = policy.sessionCloseLocalTime

  return {
    ...(policy.exchange === undefined ? {} : { exchange: policy.exchange }),
    timezone: policy.timezone,
    open: policy.sessionOpenLocalTime,
    close,
    ...(from === undefined || to === undefined ? {} : { breaks: [{ from, to }] }),
    ...(auctionFrom === undefined ? {} : { closeAuction: { from: auctionFrom, to: close } }),
  }
}

/** Zone included, because the markets here keep two clocks: a bare 14:00 means ICT for a VN board
 *  and UTC for gold. */
export function formatZonedTime(epochMs: number, timezone: string): string {
  const formatter = cachedFormatter(TIME_FORMATTERS, timezone, () => buildTimeFormatter(timezone))

  return formatter.format(new Date(epochMs))
}

function buildTimeFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(MACHINE_LOCALE, {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

/** The instant a wall-clock local time names on a given day. A brief schedule carries its own
 *  timezone, which need not be any registered market's, so this is a free function rather than a
 *  method on the calendar that happens to be nearby. */
export function resolveLocalTimeAt(day: TradingDay, localTime: string, timezone: string): number {
  return zonedEpochMs(day, minutesOfDay(localTime, timezone), timezone)
}

/** Whether a day's rows are final: it traded, and its tape has settled — the close plus the auction
 *  lag, not merely the bell. One predicate, because a pass that decides what to store and a read
 *  that decides what to serve asking it differently is how a forming board becomes a stored day. */
export function isSettled(calendar: TradingCalendar, day: TradingDay, now: number): boolean {
  return calendar.isTradingDay(day) && now >= calendar.tapeFinalAt(day)
}

/** The newest session whose rows are final — which is the previous trading day until this day's
 *  tape settles. A day called settled inside that gap is stored and served as a close it does not
 *  yet hold. */
export function resolveSettledDay(calendar: TradingCalendar, now: number): TradingDay {
  const day = calendar.dayAt(now)

  return isSettled(calendar, day, now) ? day : calendar.addTradingDays(day, -1)
}

/** Whether a day-less tape endpoint would answer with `day` right now: its tape has settled and the
 *  next session has not opened over it. Distinct from `isSettled`, which has no upper bound — a day
 *  stays settled forever, while the board that serves it without being asked for a date stops
 *  serving it at the next open. Any read of such an endpoint is only correct inside this window, and
 *  a provider whose payload carries no date of its own has no other way to be checked.
 *
 *  Always false for a continuous calendar, whose next open precedes its own tape-settle lag. No
 *  continuous market publishes a day-less tape today; one that did would read from the store only. */
export function isTapeServing(calendar: TradingCalendar, day: TradingDay, now: number): boolean {
  return (
    now >= calendar.tapeFinalAt(day) &&
    now < calendar.sessionOpenAt(calendar.addTradingDays(day, 1))
  )
}

/** Whether an observation is genuinely fresher than the last settled close, which is what separates
 *  a price the market is making now from that close restated. Two tests, because neither alone is
 *  enough: the session the reading belongs to, since a closing auction prints minutes after the
 *  bell and an instant test alone would call today's settled close a live reading for the rest of
 *  the day; and its age, since a provider that stops advancing mid-session keeps answering with a
 *  bar from hours ago that carries today's date and passes the session test unchanged. */
export function isLiveObservation(
  calendar: TradingCalendar,
  observedAt: number,
  now: number
): boolean {
  return (
    calendar.dayAt(observedAt) > resolveSettledDay(calendar, now) &&
    isRecentObservation(calendar, observedAt, now)
  )
}

/** Whether a reading is close enough to the tape to still be the price it is making. Exempt during
 *  a lunch break, where the last print before it legitimately stands for the whole gap; past the
 *  bell no exemption is needed, because `isSettled` retires the session once the auction lag is up
 *  and that lag is what the budget is built from. */
export function isRecentObservation(
  calendar: TradingCalendar,
  observedAt: number,
  now: number
): boolean {
  return sessionPhase(calendar, now) === 'break' || now - observedAt <= MAXIMUM_OBSERVATION_AGE_MS
}

export function sessionPhase(calendar: TradingCalendar, now: number): SessionPhase {
  const day = calendar.dayAt(now)

  if (!calendar.isTradingDay(day)) {
    return 'non-session'
  }

  const state = calendar.sessionState(now)

  // `closed` can only be the break here: the weekend returned above, and the state is `pre-open`
  // before the open and `post-close` after it.
  return state === 'closed' ? 'break' : state
}

/** A market's own day at one instant: the date on its clock, whether it trades, the next day it
 *  does, and where the session stands. */
export interface MarketDay {
  readonly today: TradingDay
  readonly tradesToday: boolean
  readonly nextTradingDay: TradingDay
  readonly phase: SessionPhase
}

export function resolveMarketDay(calendar: TradingCalendar, now: number): MarketDay {
  const today = calendar.dayAt(now)

  return {
    today,
    tradesToday: calendar.isTradingDay(today),
    nextTradingDay: calendar.addTradingDays(today, 1),
    phase: sessionPhase(calendar, now),
  }
}

/** The session an order placed at `now` fills in: today until the close, the next trading day after
 *  it or on a day the market does not trade. */
export function orderSessionOf(calendar: TradingCalendar, now: number): TradingDay {
  const today = calendar.dayAt(now)
  const phase = sessionPhase(calendar, now)

  return phase === 'post-close' || phase === 'non-session'
    ? calendar.addTradingDays(today, 1)
    : today
}

/** Day arithmetic that ignores sessions, for a schedule that runs every calendar day. Trading-day
 *  arithmetic is `TradingCalendar.addTradingDays`; these are different questions. */
export function shiftCalendarDay(day: TradingDay, delta: number): TradingDay {
  return shiftDay(day, delta)
}

// Both bounds are validated at construction rather than at each state read: a malformed local time
// is an operator config error, and the honest place to name it is where the policy enters.
function resolveSession(policy: CalendarPolicy): SessionMinutes {
  const open = minutesOfDay(policy.sessionOpenLocalTime, policy.timezone)
  const close = minutesOfDay(policy.sessionCloseLocalTime, policy.timezone)

  if (close <= open) {
    throw new ConfigError(`calendar ${policy.timezone} closes before it opens`, undefined, [
      'calendar',
      policy.timezone,
    ])
  }

  const breakStart = optionalMinutes(policy.breakStartLocalTime, policy.timezone)
  const breakEnd = optionalMinutes(policy.breakEndLocalTime, policy.timezone)
  const auctionStart = optionalMinutes(policy.closeAuctionStartLocalTime, policy.timezone)

  if (breakStart !== undefined && breakEnd !== undefined && breakEnd <= breakStart) {
    throw new ConfigError(`calendar ${policy.timezone} has an inverted break`, undefined, [
      'calendar',
      policy.timezone,
    ])
  }

  if (auctionStart !== undefined && (auctionStart <= open || auctionStart >= close)) {
    throw new ConfigError(
      `calendar ${policy.timezone} has an auction outside its session`,
      undefined,
      ['calendar', policy.timezone]
    )
  }

  return {
    open,
    close,
    ...(breakStart === undefined ? {} : { breakStart }),
    ...(breakEnd === undefined ? {} : { breakEnd }),
  }
}

function addTradingDays(
  day: TradingDay,
  count: number,
  isTradingDay: (candidate: TradingDay) => boolean
): TradingDay {
  const step = count < 0 ? -1 : 1
  let remaining = Math.abs(count)
  let cursor = day
  // Counted since the last session found, never in total: a long window walks past a decade of
  // days legitimately, and only a decade with no session in it says the policy is broken.
  let daysWithoutSession = 0

  while (remaining > 0) {
    daysWithoutSession += 1

    if (daysWithoutSession > MAXIMUM_DAYS_WITHOUT_SESSION) {
      throw new ConfigError('calendar has no trading day within a decade', undefined, ['calendar'])
    }

    cursor = shiftDay(cursor, step)

    if (isTradingDay(cursor)) {
      remaining -= 1
      daysWithoutSession = 0
    }
  }

  return cursor
}

interface SessionStateInput {
  readonly epochMs: number
  readonly policy: CalendarPolicy
  readonly session: SessionMinutes
  isTradingDay(day: TradingDay): boolean
}

function resolveSessionState(input: SessionStateInput): TradingSessionState {
  const { policy, session } = input

  if (!input.isTradingDay(dayFromEpochSeconds(input.epochMs / MS_PER_SECOND, policy.timezone))) {
    return 'closed'
  }

  if (policy.continuous) {
    return 'open'
  }

  const minutes = localMinutes(input.epochMs, policy.timezone)

  if (minutes < session.open) {
    return 'pre-open'
  }

  if (minutes >= session.close) {
    return 'post-close'
  }

  return isInBreak(minutes, session) ? 'closed' : 'open'
}

// The lunch gap is a calendar fact — auction phases are market tradeability facts and stay out of
// the calendar, so the only mid-session state is `closed`.
function isInBreak(minutes: number, session: SessionMinutes): boolean {
  return (
    session.breakStart !== undefined &&
    session.breakEnd !== undefined &&
    minutes >= session.breakStart &&
    minutes < session.breakEnd
  )
}

/** Wall-clock local time to the instant it names. The offset is read at a first guess and then at
 *  the guessed instant: a zone that changes offset between the two (DST) needs exactly one
 *  correction, and a further pass can never move the answer again. */
function zonedEpochMs(day: TradingDay, minutes: number, timezone: string): number {
  const naive = Date.parse(`${day}T00:00:00Z`) + minutes * MS_PER_MINUTE
  const guess = naive - zoneOffsetMs(naive, timezone)

  return naive - zoneOffsetMs(guess, timezone)
}

function zoneOffsetMs(epochMs: number, timezone: string): number {
  const parts = zonedParts(epochMs, timezone)

  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    epochMs
  )
}

function localMinutes(epochMs: number, timezone: string): number {
  const parts = zonedParts(epochMs, timezone)

  return parts.hour * MINUTES_PER_HOUR + parts.minute
}

interface ZonedParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

function zonedParts(epochMs: number, timezone: string): ZonedParts {
  const formatter = cachedFormatter(ZONE_FORMATTERS, timezone, () => buildZoneFormatter(timezone))
  const parts = formatter.formatToParts(new Date(epochMs))
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // A zone rendering midnight as hour 24 would otherwise land a day late.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  }
}

function buildZoneFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(MACHINE_LOCALE, {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function optionalMinutes(raw: string | undefined, timezone: string): number | undefined {
  return raw === undefined ? undefined : minutesOfDay(raw, timezone)
}

function minutesOfDay(raw: string, timezone: string): number {
  const match = LOCAL_TIME_RE.exec(raw)

  if (!match) {
    throw new ConfigError(`calendar ${timezone} has an invalid local time: ${raw}`, undefined, [
      'calendar',
      timezone,
    ])
  }

  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2])
}

/** Whether a day falls on the market's own weekend, which no holiday list needs to name. */
export function isWeekendDay(policy: CalendarPolicy, day: TradingDay): boolean {
  return policy.weekendDays.includes(dayOfWeek(day))
}

function dayOfWeek(day: TradingDay): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay()
}

function shiftDay(day: TradingDay, delta: number): TradingDay {
  const shifted = new Date(Date.parse(`${day}T00:00:00Z`) + delta * MS_PER_DAY)

  return tradingDay(shifted.toISOString().slice(0, 10))
}
