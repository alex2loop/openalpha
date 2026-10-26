import { computed, type ReadonlySignal } from '@preact/signals'

import type { AgentWire } from '@/app/server/wire/agents'
import type { MarketSessionWire } from '@/app/server/wire/market'
import type { SessionPhase } from '@/app/server/wire/vocab'
import type { ActorId, LifeLine } from '@/web/scene/types'
import type { ClockParts } from '@/web/text/time'
import { clockMode, pageMinute } from '@/web/scene/clock/clock'
import { toMinute } from '@/web/scene/data/agenda'
import { exDividendToday } from '@/web/scene/data/ex-dividends'
import { homeMarket, regionPack } from '@/web/scene/data/home'
import { homeIndex } from '@/web/scene/data/led'
import { ownActorIdOf } from '@/web/scene/sim/actors/roster'
import { begin } from '@/web/scene/sim/life/schedule'
import { type LifeState, type LifeStep, seatedFree, seatPoseOf } from '@/web/scene/sim/life/state'
import { propsOn } from '@/web/scene/world/props'
import { isInRange, type SpecialDay, specialDaysOf } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { agents } from '@/web/state/agents'

const INCOME_GOAL = 'income'
const ANALYST: ActorId = 'analyst'
const EXPIRY_HOLDERS: readonly ActorId[] = ['trader', 'risk']
const NO_HOLDS: readonly LifeLine[] = Object.freeze([])
// A close at or above this percent on the home index raises one free person's hands.
const MOOD_RISE_PCT = 1
const CHEER_MS = 4_000
const BELL_LOOK_MS = 3_000
const BELL_PHASES: ReadonlySet<SessionPhase> = new Set(['open', 'post-close'])
const CLOSED_PHASES: ReadonlySet<SessionPhase> = new Set(['post-close', 'non-session'])
// The lobby screens everyone turns to at the bell: the agenda's two screens.
export const LOBBY_SCREENS = propsOn('office').filter((prop) => prop.tip === 'agenda')
export const BELL_LOOK_AT = Object.freeze({
  x: averageOf(LOBBY_SCREENS.map((prop) => prop.rect.x + prop.rect.w / 2)),
  y: averageOf(LOBBY_SCREENS.map((prop) => prop.rect.y + prop.rect.h)),
})

/** What the calendar and the home market's session make of this minute: whether it trades today,
 *  the phase, the closing auction, the first minutes after the open (no trips), the after-close
 *  mood and what sets the day apart. Calendar and session only; it follows each page minute and a
 *  clock change at once. */
interface Moment {
  readonly tradingDay: boolean
  readonly phase?: SessionPhase
  readonly closingAuction: boolean
  readonly noTrips: boolean
  readonly relaxed: boolean
  readonly special: readonly SpecialDay[]
}

/** The home market's phase on the page clock; absent for a market without session hours, where
 *  nothing that follows the trading day happens. */
export const homePhase: ReadonlySignal<SessionPhase | undefined> = computed(() => {
  const session = homeMarket.value?.session

  return session === undefined
    ? undefined
    : phaseOf(session, pageMinute.value, clockMode.value.kind === 'preview')
})

/** The page minute's moment, from `homeMarket` and `homePhase`. A market without a session trades
 *  every day and has none of the session's moments. */
export const moment: ReadonlySignal<Moment> = computed(() => {
  const session = homeMarket.value?.session
  const clock = pageMinute.value
  const phase = homePhase.value
  const tradingDay = session === undefined || session.today !== clock.day || session.tradesToday
  const hours = session === undefined || !tradingDay ? undefined : session

  return {
    tradingDay,
    ...(phase === undefined ? {} : { phase }),
    closingAuction: isAuction(hours, { phase, minute: clock.minute }),
    noTrips: hours !== undefined && isInRange(clock.minute, noTripsOf(hours)),
    relaxed: hours !== undefined && isInRange(clock.minute, relaxedOf(hours)),
    special: specialDaysOf(clock.day, regionPack.value, tradingDay),
  }
})

/** The own agent hunting income (`focus.goal`, a mark only); absent when none is. */
export const incomeAgent: ReadonlySignal<AgentWire | undefined> = computed(() =>
  agents.value.find((agent) => agent.focus?.goal === INCOME_GOAL)
)

/** Who the day keeps at their desk, each with the line that says why: on an ex-dividend day from
 *  the open to the lunch nap the income agent (else the analyst), through an expiry day's session
 *  the trader and the risk analyst. */
export const deskHolds: ReadonlySignal<readonly LifeLine[]> = computed(() => {
  const { phase, special } = moment.value

  if (phase !== 'open') {
    return NO_HOLDS
  }

  const tickers = [...new Set(exDividendToday.value.map((held) => held.ticker))]
  const isExDay = tickers.length > 0 && pageMinute.value.minute < regionPack.value.officeLife.nap[0]
  const agent = incomeAgent.value

  return [
    ...(isExDay
      ? [
          {
            actor: agent === undefined ? ANALYST : ownActorIdOf(agent.id),
            label: 'exDividend' as const,
            ticker: tickers.join(', '),
          },
        ]
      : []),
    ...(special.includes('expiry')
      ? EXPIRY_HOLDERS.map((actor) => ({ actor, label: 'expiry' as const }))
      : []),
  ]
})

/** The day keeps this person at their desk: no trip, chat or coffee. */
export function isKept(actor: ActorId): boolean {
  return deskHolds.value.some((hold) => hold.actor === actor)
}

/** In real time the wire's own phase; under a preview hour the phase that minute falls in on the
 *  session's hours. The date stays real, so `tradesToday` holds. */
function phaseOf(session: MarketSessionWire, parts: ClockParts, preview: boolean): SessionPhase {
  if (!preview) {
    return session.phase
  }

  if (!session.tradesToday) {
    return 'non-session'
  }

  const minute = parts.minute

  if (minute < toMinute(session.open)) {
    return 'pre-open'
  }

  if (minute >= toMinute(session.close)) {
    return 'post-close'
  }

  const isInBreak = (session.breaks ?? []).some(
    (gap) => minute >= toMinute(gap.from) && minute < toMinute(gap.to)
  )

  return isInBreak ? 'break' : 'open'
}

/** The home market is shut for the day on the page clock: the lobby dims. */
export function isClosedPhase(phase: SessionPhase | undefined): boolean {
  return phase !== undefined && CLOSED_PHASES.has(phase)
}

/** The market bell: when the home phase turns open or post-close, the free people of the office
 *  floor turn toward the lobby screens for `BELL_LOOK_MS`, and at a rising close one raises their
 *  hands. The first phase the page reads rings nothing. */
export function stepBell(state: LifeState, step: LifeStep): void {
  const phase = homePhase.value
  const last = state.lastPhase

  state.lastPhase = phase

  if (phase === undefined || last === undefined || phase === last || !BELL_PHASES.has(phase)) {
    return
  }

  if (!step.canWalk) {
    return
  }

  for (const actor of seatedFree(step, 'office')) {
    begin(state, { actor, kind: 'look', nowMs: step.nowMs }, [
      { pose: seatPoseOf(actor), look: BELL_LOOK_AT, holdMs: BELL_LOOK_MS },
    ])
  }

  if (phase === 'post-close') {
    raiseHands(state, step)
  }
}

// A close on a good rise: one free person at their seat raises both hands. A missing or stale
// index raises none.
function raiseHands(state: LifeState, step: LifeStep): void {
  const index = homeIndex.value
  const isUp = index !== undefined && !index.stale && (index.changePct ?? 0) >= MOOD_RISE_PCT
  const [first, ...rest] = seatedFree(step, 'office')

  if (isUp && first !== undefined) {
    const actor = createRng(seedOf('cheer', step.clock.day)).pick([first, ...rest])

    state.director.play(actor.def.id, { pose: 'hands-up', ms: CHEER_MS })
  }
}

// The closing auction runs inside the session while it is open.
function isAuction(
  session: MarketSessionWire | undefined,
  at: { readonly phase: SessionPhase | undefined; readonly minute: number }
): boolean {
  const auction = at.phase === 'open' ? session?.closeAuction : undefined

  return (
    auction !== undefined && isInRange(at.minute, [toMinute(auction.from), toMinute(auction.to)])
  )
}

// From the open for the pack's quiet minutes.
function noTripsOf(session: MarketSessionWire): readonly [number, number] {
  const open = toMinute(session.open)

  return [open, open + regionPack.value.officeLife.noTripsAfterOpenMin]
}

// From the close until the pack's after-close mood ends.
function relaxedOf(session: MarketSessionWire): readonly [number, number] {
  return [toMinute(session.close), regionPack.value.officeLife.relaxedUntil]
}

function averageOf(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}
