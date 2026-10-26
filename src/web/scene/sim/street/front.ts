import type { BoardView, FrontView, ShutterView } from '@/web/scene/street-types'
import type { Rect } from '@/web/scene/types'
import type { RegionPack, ShopRow } from '@/web/scene/world/regions'
import { pageMinute, pageNow } from '@/web/scene/clock/clock'
import { type LedItem, ledItems } from '@/web/scene/data/led'
import {
  frontageOf,
  isLateNight,
  SHOP_RISE,
  shopRowSpanOf,
  shopSpansOf,
} from '@/web/scene/world/frontage'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { isInside, isOverlapping } from '@/web/scene/world/rooms'
import { NORTH } from '@/web/scene/world/street-layout'
import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from '@/web/text/time-units'

/** The board turns to its next panel this often. */
const LED_PANEL_MS = 5_000
/** The board's hourly light pulse lasts this long. */
const LED_PULSE_MS = 5_000
// The ticker band scrolls this fast, whole px at a time.
const LED_SCROLL_PX_S = 12
// A shutter moves for this many page minutes, in this many steps, ahead of a shop's opening and
// after its closing.
const SHUTTER_MINUTES = 0.5
const SHUTTER_STEPS = 8
const PULSE_STEPS = 8
// The guard walks the frontage a little way in front of the lot's rows.
const GUARD_PX_S = 5
const GUARD_DEPTH = 8
const GUARD_INSET = 6
const MAX_STEP_S = 0.5

interface GuardState {
  readonly prev: { x: number; y: number }
  readonly at: { x: number; y: number }
  heading: -1 | 1
}

/** The shop row's and the board's moving parts. `view` is what the painter reads, kept in place;
 *  the rest is the sim's own. */
export interface Front {
  readonly view: { -readonly [K in keyof FrontView]: FrontView[K] }
  readonly shutters: ShutterView[]
  readonly board: { -readonly [K in keyof BoardView]: BoardView[K] }
  readonly guard: GuardState
  items: readonly LedItem[]
  range: readonly [number, number]
  lastStepAt: number
  isAnimating: boolean
}

export function createFront(): Front {
  const shutters: ShutterView[] = []
  const board = { panel: 0, scrollPx: 0, pulse: 0 }

  return {
    view: { shutters, guard: undefined, board, row: undefined, face: undefined },
    shutters,
    board,
    guard: { prev: { x: 0, y: 0 }, at: { x: 0, y: 0 }, heading: 1 },
    items: [],
    range: [0, 0],
    lastStepAt: 0,
    isAnimating: false,
  }
}

/** Lays the row out for the pack and puts the guard at a place the day and minute choose. */
export function resetFront(
  front: Front,
  at: { readonly pack: RegionPack; readonly day: string; readonly nowMs: number }
): void {
  const span = shopRowSpanOf(at.pack.shops)
  const frontage = frontageOf(at.pack.shops)
  const rng = createRng(seedOf(at.day, at.pack.id, 'guard'))

  front.view.row =
    span === undefined
      ? undefined
      : { x: span[0], y: NORTH.farTop - SHOP_RISE, w: span[1] - span[0], h: SHOP_RISE }
  front.view.face =
    frontage === undefined
      ? undefined
      : {
          x: frontage.board.x,
          y: frontage.board.y,
          w: frontage.board.w,
          h: frontage.band.y + frontage.band.h - frontage.board.y,
        }
  front.range =
    frontage === undefined
      ? [0, 0]
      : [frontage.body.x + GUARD_INSET, frontage.body.x + frontage.body.w - GUARD_INSET]
  front.guard.at.x = front.range[0] + rng.next() * (front.range[1] - front.range[0])
  front.guard.at.y = NORTH.farTop + GUARD_DEPTH
  front.guard.prev.x = front.guard.at.x
  front.guard.prev.y = front.guard.at.y
  front.guard.heading = rng.next() < 0.5 ? -1 : 1
  front.lastStepAt = at.nowMs
  front.shutters.length = 0
  front.items = ledItems.peek()
}

/** Moves the shutters, the guard and the board's clock one step; true when something drawn
 *  changed. A reduced-motion page keeps the first panel and everything still. */
export function stepFront(
  front: Front,
  at: { readonly pack: RegionPack; readonly nowMs: number; readonly isReduced: boolean }
): boolean {
  const minute = minuteNow()
  const items = ledItems.peek()
  const dt = Math.min(MAX_STEP_S, Math.max(0, (at.nowMs - front.lastStepAt) / MS_PER_SECOND))
  const isItemsChanged = items !== front.items
  const isShutterChanged = at.isReduced
    ? clearShutters(front)
    : syncShutters(front, at.pack.shops, minute)
  const isGuardMoved = at.isReduced ? clearGuard(front) : syncGuard(front, { minute, dt })
  const isBoardChanged = syncBoard(front, {
    items,
    nowMs: at.nowMs,
    minute,
    isReduced: at.isReduced,
  })

  front.items = items
  front.lastStepAt = at.nowMs
  front.isAnimating =
    front.shutters.length > 0 || isGuardMoved || front.board.pulse > 0 || front.board.scrollPx > 0

  return isItemsChanged || isShutterChanged || isGuardMoved || isBoardChanged
}

/** The board, a shutter on the move or the guard is in `rect`. */
export function isFrontShown(view: FrontView, rect: Rect): boolean {
  const { face, row, guard } = view

  return (
    (face !== undefined && isOverlapping(rect, face)) ||
    (row !== undefined && view.shutters.length > 0 && isOverlapping(rect, row)) ||
    (guard !== undefined && isInside(rect, guard.at))
  )
}

/** The front moves, in `rect`. */
export function isFrontMoving(front: Front, rect: Rect): boolean {
  return front.isAnimating && isFrontShown(front.view, rect)
}

/** When the board turns to its next panel, a `performance.now()` instant; `Infinity` with fewer
 *  than two panels. */
export function nextPanelAt(front: Front, nowMs: number): number {
  return front.items.length < 2
    ? Number.POSITIVE_INFINITY
    : (Math.floor(nowMs / LED_PANEL_MS) + 1) * LED_PANEL_MS
}

// The page minute with its fraction: the signal moves once a minute, the page clock between.
function minuteNow(): number {
  return Math.floor(pageMinute.peek().minute) + (pageNow() % MS_PER_MINUTE) / MS_PER_MINUTE
}

function syncShutters(front: Front, shops: readonly ShopRow[], minute: number): boolean {
  const spans = shopSpansOf(shops)
  let count = 0
  let isChanged = false

  for (let shop = 0; shop < spans.length; shop++) {
    const drop = dropOf(spans[shop]?.row, minute)

    if (drop !== undefined) {
      const held = front.shutters[count]

      if (held?.shop !== shop || held.drop !== drop) {
        front.shutters[count] = { shop, drop }
        isChanged = true
      }

      count++
    }
  }

  if (front.shutters.length !== count) {
    front.shutters.length = count
    isChanged = true
  }

  return isChanged
}

// How far down a shop's shutter is while it moves: after its closing and before its opening. A
// shop that never closes, or never opens, has none.
function dropOf(row: ShopRow | undefined, minute: number): number | undefined {
  if (row === undefined) {
    return undefined
  }

  const [opens, closes] = row.hours

  if (closes <= 0 || closes >= MINUTES_PER_DAY) {
    return undefined
  }

  if (minute >= closes && minute < closes + SHUTTER_MINUTES) {
    return stepOf((minute - closes) / SHUTTER_MINUTES, SHUTTER_STEPS)
  }

  const from = opens - SHUTTER_MINUTES

  return minute >= from && minute < opens
    ? stepOf(1 - (minute - from) / SHUTTER_MINUTES, SHUTTER_STEPS)
    : undefined
}

// Under reduced motion the shop row stands as the clock left it: shutters up or down, no guard.
function clearShutters(front: Front): boolean {
  const isChanged = front.shutters.length > 0

  front.shutters.length = 0

  return isChanged
}

function clearGuard(front: Front): boolean {
  front.view.guard = undefined

  return false
}

function syncGuard(front: Front, at: { readonly minute: number; readonly dt: number }): boolean {
  const { guard } = front
  const isOnDuty = front.view.face !== undefined && isLateNight(at.minute)

  front.view.guard = isOnDuty ? guard : undefined

  if (!isOnDuty) {
    return false
  }

  const [from, to] = front.range

  guard.prev.x = guard.at.x
  guard.at.x += guard.heading * GUARD_PX_S * at.dt

  if (guard.at.x <= from || guard.at.x >= to) {
    guard.at.x = Math.min(to, Math.max(from, guard.at.x))
    guard.heading = guard.heading === 1 ? -1 : 1
  }

  return at.dt > 0
}

function syncBoard(
  front: Front,
  at: {
    readonly items: readonly LedItem[]
    readonly nowMs: number
    readonly minute: number
    readonly isReduced: boolean
  }
): boolean {
  const { board } = front
  const isScrolling = !at.isReduced && at.items.some((item) => item.state === 'open')
  const panel =
    at.isReduced || at.items.length < 2 ? 0 : Math.floor(at.nowMs / LED_PANEL_MS) % at.items.length
  const scrollPx = isScrolling ? Math.floor((at.nowMs / MS_PER_SECOND) * LED_SCROLL_PX_S) : 0
  const pulse = at.isReduced ? 0 : pulseOf(at.minute)
  const isChanged = board.panel !== panel || board.scrollPx !== scrollPx || board.pulse !== pulse

  board.panel = panel
  board.scrollPx = scrollPx
  board.pulse = pulse

  return isChanged
}

// A soft swell in the first seconds of each hour of the page clock, in steps.
function pulseOf(minute: number): number {
  const seconds = (minute % MINUTES_PER_HOUR) * SECONDS_PER_MINUTE
  const length = LED_PULSE_MS / MS_PER_SECOND

  return seconds >= length ? 0 : stepOf(Math.sin((Math.PI * seconds) / length) ** 2, PULSE_STEPS)
}

// `share` (0 to 1) in whole steps, never less than one.
function stepOf(share: number, steps: number): number {
  return Math.max(1, Math.round(share * steps)) / steps
}
