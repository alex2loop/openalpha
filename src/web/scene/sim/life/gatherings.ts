import type { ActorState } from '@/web/scene/sim/director'
import type { LifeState, LifeStep } from '@/web/scene/sim/life/state'
import type { LifeLine, Point } from '@/web/scene/types'
import { clockMode, pageNow } from '@/web/scene/clock/clock'
import { toMinute } from '@/web/scene/data/agenda'
import { indexDrop } from '@/web/scene/data/board'
import { homeMarket } from '@/web/scene/data/home'
import { distance } from '@/web/scene/sim/actors/nav'
import { OFFICE_FLOOR } from '@/web/scene/sim/life/presence'
import { begin } from '@/web/scene/sim/life/schedule'
import {
  drawBetween,
  isDoneToday,
  isPicked,
  markDone,
  momentsOn,
  seatedFree,
} from '@/web/scene/sim/life/state'
import { approachOf } from '@/web/scene/sim/places'
import { BELL_LOOK_AT, LOBBY_SCREENS, moment } from '@/web/scene/sim/rhythm'
import { propsOn } from '@/web/scene/world/props'
import { isInRange } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { MS_PER_MINUTE } from '@/web/text/time-units'

const LIBRARY_ROOM = 'lib'
const LIBRARY_PROP = 'shelf'
const LIBRARY_TAG = 'library'
// A drop in the home index gathers 2 or 3 free people at the lobby screens for a minute or so, and
// not twice within half an hour of page time.
const MOOD_GATHER_COUNT = Object.freeze({ min: 2, max: 3 })
const MOOD_GATHER_MS = Object.freeze({ min: 60_000, max: 90_000 })
const MOOD_GAP_MS = 1_800_000
// The auction watchers stand at least this long, even when it is nearly over.
const AUCTION_MIN_WATCH_MS = 8_000
const AUCTION_TAG = 'auction'
// While it is report season, one free person from another room now and then goes to the library
// shelves.
const LIBRARY_PICK_PERCENT = 60
const LIBRARY_GAP_MS = Object.freeze({ min: 60_000, max: 150_000 })
const LIBRARY_HOLD_MS = Object.freeze({ min: 6_000, max: 11_000 })
const LIBRARY_GAP_KEY = 'office:library'
// Where the people stand at the lobby screens: below each screen, and a step to either side.
const SPOT_SPREAD_PX = 9
const SPOT_ROW_PX = 6
const SCREEN_SPOTS: readonly Point[] = LOBBY_SCREENS.flatMap((prop) => {
  const at = approachOf(prop)

  return [
    at,
    { x: at.x - SPOT_SPREAD_PX, y: at.y + SPOT_ROW_PX },
    { x: at.x + SPOT_SPREAD_PX, y: at.y + SPOT_ROW_PX },
  ]
})
const LIBRARY_SPOTS: readonly Point[] = propsOn(OFFICE_FLOOR)
  .filter((prop) => prop.kind === LIBRARY_PROP && prop.room === LIBRARY_ROOM)
  .map(approachOf)

/** The moments of the market's day that gather people: the closing auction, a drop in the index,
 *  the report season's library trips. */
export function stepGatherings(state: LifeState, step: LifeStep): void {
  stepAuction(state, step)
  stepGather(state, step)
  stepLibrary(state, step)
}

// Every free person at their seat stands and watches the lobby screens until the auction ends.
function stepAuction(state: LifeState, step: LifeStep): void {
  const auction = homeMarket.value?.session?.closeAuction

  if (!(moment.value.closingAuction && step.canWalk) || auction === undefined) {
    return
  }

  const day = step.clock.day
  const watching = momentsOn(state, { step, floor: OFFICE_FLOOR, kind: 'auction' })
  const people = lobbyPeople(step).filter(
    (actor) => !isDoneToday(state, { actor: actor.def.id, tag: AUCTION_TAG, day })
  )
  const leftMs = Math.max(
    AUCTION_MIN_WATCH_MS,
    ((toMinute(auction.to) - step.clock.minute) * MS_PER_MINUTE) / speedOf()
  )

  for (const [at, actor] of people
    .slice(0, Math.max(0, SCREEN_SPOTS.length - watching))
    .entries()) {
    const line: LifeLine = {
      actor: actor.def.id,
      label: 'closingAuction',
      from: auction.from,
      to: auction.to,
    }

    markDone(state, { actor: actor.def.id, tag: AUCTION_TAG, day })
    watch(state, { actor, kind: 'auction', spot: watching + at, holdMs: leftMs, line, step })
  }
}

// A new drop notice of the home index, while its session is open, gathers a few free people.
function stepGather(state: LifeState, step: LifeStep): void {
  const drop = indexDrop.value
  const { rhythm } = state

  if (
    drop === undefined ||
    drop.noticeId === rhythm.moodNoticeId ||
    !(moment.value.phase === 'open' && !moment.value.noTrips && step.canWalk)
  ) {
    return
  }

  if (pageNow() - rhythm.moodAt < MOOD_GAP_MS) {
    rhythm.moodNoticeId = drop.noticeId
    return
  }

  const count = createRng(seedOf('gather', drop.noticeId)).int(
    MOOD_GATHER_COUNT.min,
    MOOD_GATHER_COUNT.max
  )
  const people = lobbyPeople(step).slice(0, count)

  if (people.length < MOOD_GATHER_COUNT.min) {
    return
  }

  rhythm.moodNoticeId = drop.noticeId
  rhythm.moodAt = pageNow()

  for (const [spot, actor] of people.entries()) {
    const line: LifeLine = { actor: actor.def.id, label: 'drop', index: indexNameOf() }
    const holdMs = drawBetween(MOOD_GATHER_MS, 'gather', drop.noticeId, actor.def.id)

    watch(state, { actor, kind: 'gather', spot, holdMs, line, step })
  }
}

// In report season a free person from another room walks to the library shelves now and then.
function stepLibrary(state: LifeState, step: LifeStep): void {
  const { arrive, leave } = step.pack
  const isSeason = moment.value.special.includes('earnings')
  const isDay = isInRange(step.clock.minute, [arrive[1], leave[0]])
  const [firstSpot, ...otherSpots] = LIBRARY_SPOTS
  const isReady = step.nowMs >= (state.gaps.get(LIBRARY_GAP_KEY) ?? 0)

  if (!(isSeason && isDay && step.isCalm && isReady) || firstSpot === undefined) {
    return
  }

  if (momentsOn(state, { step, floor: OFFICE_FLOOR, kind: LIBRARY_TAG }) > 0) {
    return
  }

  const day = step.clock.day
  const people = seatedFree(step, OFFICE_FLOOR).filter(
    (candidate) =>
      candidate.def.room !== LIBRARY_ROOM &&
      isPicked({ actor: candidate.def.id, tag: LIBRARY_TAG, day }, LIBRARY_PICK_PERCENT)
  )
  const [first, ...rest] = people

  if (first === undefined) {
    return
  }

  const rng = createRng(seedOf(LIBRARY_TAG, day, String(step.nowMs)))
  const actor = rng.pick([first, ...rest])
  const spot = rng.pick([firstSpot, ...otherSpots])
  const holdMs = drawBetween(LIBRARY_HOLD_MS, LIBRARY_TAG, actor.def.id, String(step.nowMs))

  state.gaps.set(LIBRARY_GAP_KEY, step.nowMs + drawBetween(LIBRARY_GAP_MS, LIBRARY_GAP_KEY, day))
  begin(
    state,
    {
      actor,
      kind: LIBRARY_TAG,
      nowMs: step.nowMs,
      line: { actor: actor.def.id, label: 'earnings' },
    },
    [{ at: spot, pose: 'stand', holdMs }]
  )
}

// The free people at their seat, those nearest the lobby screens first.
function lobbyPeople(step: LifeStep): ActorState[] {
  return seatedFree(step, OFFICE_FLOOR).sort(
    (a, b) => distance(a.walker.pos, BELL_LOOK_AT) - distance(b.walker.pos, BELL_LOOK_AT)
  )
}

function watch(
  state: LifeState,
  at: {
    readonly actor: ActorState
    readonly kind: 'auction' | 'gather'
    readonly spot: number
    readonly holdMs: number
    readonly line: LifeLine
    readonly step: LifeStep
  }
): void {
  const place = SCREEN_SPOTS[at.spot % SCREEN_SPOTS.length]

  if (place !== undefined) {
    begin(state, { actor: at.actor, kind: at.kind, nowMs: at.step.nowMs, line: at.line }, [
      { at: place, pose: 'stand', look: BELL_LOOK_AT, holdMs: at.holdMs },
    ])
  }
}

// A preview hour runs faster than the page's own time.
function speedOf(): number {
  const mode = clockMode.value

  return mode.kind === 'preview' ? mode.speed : 1
}

function indexNameOf(): string {
  const market = homeMarket.value

  return market?.benchmark?.ticker ?? market?.label ?? ''
}
