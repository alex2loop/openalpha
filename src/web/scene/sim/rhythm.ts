import { computed, type ReadonlySignal } from '@preact/signals'

import type { MarketSessionWire } from '@/app/server/wire/market'
import type { SessionPhase } from '@/app/server/wire/vocab'
import type { ClockParts } from '@/web/text/time'
import { clockMode, pageMinute } from '@/web/scene/clock/clock'
import { toMinute } from '@/web/scene/data/agenda'
import { homeMarket } from '@/web/scene/data/home'
import { begin } from '@/web/scene/sim/life/schedule'
import { type LifeState, type LifeStep, seatedFree, seatPoseOf } from '@/web/scene/sim/life/state'
import { propsOn } from '@/web/scene/world/props'

const BELL_LOOK_MS = 3_000
const BELL_PHASES: ReadonlySet<SessionPhase> = new Set(['open', 'post-close'])
const CLOSED_PHASES: ReadonlySet<SessionPhase> = new Set(['post-close', 'non-session'])
// The lobby screens everyone turns to at the bell: the agenda's two screens.
const LOBBY_SCREENS = propsOn('office').filter((prop) => prop.tip === 'agenda')
const BELL_LOOK_AT = Object.freeze({
  x: averageOf(LOBBY_SCREENS.map((prop) => prop.rect.x + prop.rect.w / 2)),
  y: averageOf(LOBBY_SCREENS.map((prop) => prop.rect.y + prop.rect.h)),
})

/** The home market's phase on the page clock; absent for a market without session hours, where
 *  nothing that follows the trading day happens. */
export const homePhase: ReadonlySignal<SessionPhase | undefined> = computed(() => {
  const session = homeMarket.value?.session

  return session === undefined
    ? undefined
    : phaseOf(session, pageMinute.value, clockMode.value.kind === 'preview')
})

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
 *  floor turn toward the lobby screens for `BELL_LOOK_MS`. The first phase the page reads rings
 *  nothing. */
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
}

function averageOf(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}
