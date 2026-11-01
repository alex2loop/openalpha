import type { SessionPhase } from '@/app/server/wire/vocab'
import type { LifeState, LifeStep } from '@/web/scene/sim/life/state'
import type { LifeLine } from '@/web/scene/types'
import type { HolidayId } from '@/web/scene/world/regions'
import type { Rng } from '@/web/scene/world/rng'
import { hasOwnMessage, type MessageKey } from '@/i18n'
import { pageMinute } from '@/web/scene/clock/clock'
import { regionPack } from '@/web/scene/data/home'
import { homeIndex, type LedItem } from '@/web/scene/data/led'
import { raining } from '@/web/scene/data/weather'
import { isCartStay } from '@/web/scene/sim/life/cart'
import { begin, floorsOf } from '@/web/scene/sim/life/schedule'
import { momentsOn, seatedFree } from '@/web/scene/sim/life/state'
import { moment } from '@/web/scene/sim/rhythm'
import { holidayOf } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { SOFA_SEATS } from '@/web/scene/world/seats'

type TalkContext =
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'night'
  | 'preopen'
  | 'open'
  | 'lunch'
  | 'closed'
  | 'weekend'
  | 'rain'
  | 'friday'
  | 'down'
  | 'flat'
  | 'up'
  | HolidayId

type TalkTopic = Extract<LifeLine['label'], 'chat' | 'lunch' | 'friday'>

interface Weighted {
  readonly context: TalkContext
  readonly weight: number
}

interface TalkPair {
  readonly a: MessageKey
  readonly b: MessageKey
}

interface TalkLine extends TalkPair {
  readonly label: TalkTopic
}

// An index that moved less than this percent in a day reads as flat.
const TALK_FLAT_PCT = 0.15
const TALK_PAIRS_MAX = 12
const CHAT_GAP_MS = 240_000
const CHAT_HOLD_MS = 9_400
const WEIGHT = Object.freeze({ cart: 3, holiday: 3, rain: 2, index: 2, session: 2, time: 1 })
const HOUR_MIN = 60
const TIME_BANDS: readonly { readonly until: number; readonly context: TalkContext }[] =
  Object.freeze([
    { until: 6 * HOUR_MIN, context: 'night' },
    { until: 11.5 * HOUR_MIN, context: 'morning' },
    { until: 13.5 * HOUR_MIN, context: 'noon' },
    { until: 17 * HOUR_MIN, context: 'afternoon' },
    { until: 21 * HOUR_MIN, context: 'evening' },
  ])
const LATE_CONTEXT: TalkContext = 'night'
// A market holiday reads as a weekend: the wire's phase for it is `non-session`.
const SESSION_CONTEXT: Readonly<Record<SessionPhase, TalkContext>> = Object.freeze({
  'pre-open': 'preopen',
  open: 'open',
  break: 'lunch',
  'post-close': 'closed',
  'non-session': 'weekend',
})
const TOPIC_OF: Readonly<Partial<Record<TalkContext, TalkTopic>>> = Object.freeze({
  noon: 'lunch',
  lunch: 'lunch',
  friday: 'friday',
})
const DEFAULT_TOPIC: TalkTopic = 'chat'

let lastPair: MessageKey | undefined

/** Two free people on a floor with nothing else going on sit on the sofa, turned to each other,
 *  and say a pair of small talk. */
export function stepChat(state: LifeState, step: LifeStep): void {
  if (!step.isCalm) {
    return
  }

  const gapMs = step.isRelaxed ? CHAT_GAP_MS / 2 : CHAT_GAP_MS

  for (const floor of floorsOf(step)) {
    const gapKey = `${floor}:chat`
    const [a, b] = seatedFree(step, floor)
    const seats = SOFA_SEATS[floor]
    const isWaiting = step.nowMs < (state.gaps.get(gapKey) ?? step.nowMs + gapMs)

    if (!state.gaps.has(gapKey)) {
      state.gaps.set(gapKey, step.nowMs + gapMs)
    }

    if (a === undefined || b === undefined || isWaiting || momentsOn(state, { step, floor }) > 0) {
      continue
    }

    state.gaps.set(gapKey, step.nowMs + gapMs)

    const talk = pickLine(createRng(seedOf('talk', floor, String(step.nowMs))))

    if (talk === undefined) {
      continue
    }

    for (const [actor, partner, seat, key] of [
      [a, b, seats[0], talk.a],
      [b, a, seats[1], talk.b],
    ] as const) {
      const line: LifeLine = { actor: actor.def.id, label: 'talk', key, topic: talk.label }

      begin(state, { actor, kind: 'chat', nowMs: step.nowMs, line }, [
        { at: seat.at, pose: 'chat', face: partner.def.id, holdMs: CHAT_HOLD_MS },
      ])
    }
  }
}

// What the pair says: a context drawn by chance from what holds this minute (the time, the market's
// session, rain, the dessert cart, a holiday, the index's direction), then a pair of it, never the
// pair said last; absent when no context has a line.
function pickLine(rng: Rng): TalkLine | undefined {
  const context = contextOf(contextsNow(), rng)
  const pairs = context === undefined ? [] : pairsOf(context)
  const fresh = pairs.filter((each) => each.a !== lastPair)
  const [first, ...rest] = fresh.length === 0 ? pairs : fresh

  if (context === undefined || first === undefined) {
    return undefined
  }

  const pair = rng.pick([first, ...rest])

  lastPair = pair.a

  return { ...pair, label: TOPIC_OF[context] ?? DEFAULT_TOPIC }
}

// The contexts that hold now, each with its weight.
function contextsNow(): readonly Weighted[] {
  const clock = pageMinute.value
  const { phase } = moment.value
  const held: readonly (readonly [TalkContext | undefined, number])[] = [
    [timeOf(clock.minute), WEIGHT.time],
    [phase === undefined ? undefined : SESSION_CONTEXT[phase], WEIGHT.session],
    [raining() ? 'rain' : undefined, WEIGHT.rain],
    [isCartStay(clock, regionPack.value.officeLife.dessert) ? 'friday' : undefined, WEIGHT.cart],
    [holidayOf(regionPack.value, clock.day), WEIGHT.holiday],
    [indexOf(homeIndex.value), WEIGHT.index],
  ]

  return held.flatMap(([context, weight]) => (context === undefined ? [] : [{ context, weight }]))
}

function contextOf(held: readonly Weighted[], rng: Rng): TalkContext | undefined {
  let draw = rng.next() * held.reduce((sum, each) => sum + each.weight, 0)

  for (const each of held) {
    draw -= each.weight

    if (draw < 0) {
      return each.context
    }
  }

  return held.at(-1)?.context
}

function timeOf(minute: number): TalkContext {
  return TIME_BANDS.find((band) => minute < band.until)?.context ?? LATE_CONTEXT
}

// The direction of the day's move; a missing or stale one gives no context.
function indexOf(item: LedItem | undefined): TalkContext | undefined {
  const pct = item?.changePct

  if (item === undefined || item.stale || pct === undefined) {
    return undefined
  }

  if (Math.abs(pct) < TALK_FLAT_PCT) {
    return 'flat'
  }

  return pct < 0 ? 'down' : 'up'
}

// The pairs the catalog holds for a context, numbered from 1.
function pairsOf(context: TalkContext): TalkPair[] {
  const pairs: TalkPair[] = []

  for (let n = 1; n <= TALK_PAIRS_MAX; n++) {
    const a = `ui.office.talk.${context}.${n}.a`
    const b = `ui.office.talk.${context}.${n}.b`

    if (!(isMessageKey(a) && isMessageKey(b))) {
      break
    }

    pairs.push({ a, b })
  }

  return pairs
}

function isMessageKey(key: string): key is MessageKey {
  return hasOwnMessage('en', key) && hasOwnMessage('vi', key)
}
