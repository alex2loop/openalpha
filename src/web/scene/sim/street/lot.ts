import type { Point } from '@/web/scene/types'
import { sheltersOf } from '@/web/scene/sim/street/flows'
import { isInRange, type RegionPack, shopDoorOf } from '@/web/scene/world/regions'
import { METRES_PER_PX, NORTH } from '@/web/scene/world/street-layout'

// The lot fills the frontage less this much at each end, in two rows each side of the aisle.
const LOT_INSET_PX = 4
const AISLE_PX = 7
const PITCH_PX = 3.3
// The front and back rows, down from the far pavement's back edge; the attendant's post between.
const ROW_DEPTHS = [3.3, 0.7] as const
const POST_DEPTH = 2
// The front row leaves room around a far shelter.
const SHELTER_CLEAR = Object.freeze({ before: 20, after: 11 })
// The share of slots taken over the office day: full, at lunch, after the evening leave.
const FULL_SHARE = 0.85
const LUNCH_SHARE = 0.78
const EVENING_SHARE = 0.25
const ATTENDANT_PX_PER_S = 9
const TICKET_MS = 2_000
const ARRIVED_PX = 0.3

interface Attendant {
  readonly prev: { x: number; y: number }
  readonly at: { x: number; y: number }
  handing: boolean
}

/** The motorbike lot in front of the frontage building and its attendant, who walks to each bike
 *  that comes or goes and hands over the ticket. */
export interface Lot {
  readonly slots: Point[]
  post: Point
  parked: number
  onDuty: boolean
  target: Point | undefined
  handUntil: number
  readonly attendant: Attendant
  readonly view: { slots: readonly Point[]; parked: number; attendant: Attendant | undefined }
}

export function createLot(): Lot {
  const slots: Point[] = []
  const attendant: Attendant = { prev: { x: 0, y: 0 }, at: { x: 0, y: 0 }, handing: false }

  return {
    slots,
    post: { x: 0, y: 0 },
    parked: 0,
    onDuty: false,
    target: undefined,
    handUntil: 0,
    attendant,
    view: { slots, parked: 0, attendant: undefined },
  }
}

/** Lays the slots out for the pack (none without its road habits or a lobby) and fills them to
 *  the minute, the attendant at the post. */
export function resetLot(
  lot: Lot,
  at: { readonly pack: RegionPack; readonly minute: number }
): void {
  const { pack } = at
  const lobby = pack.shops.findIndex((shop) => shop.kind === 'lobby')
  const row = pack.shops[lobby]

  lot.slots.length = 0
  lot.target = undefined
  lot.handUntil = 0

  if (pack.road.habits && row !== undefined) {
    const door = shopDoorOf(pack.shops, lobby)

    lot.post = { x: door.x, y: NORTH.farTop + POST_DEPTH }
    layOut(lot.slots, { pack, door, halfW: row.frontageM / METRES_PER_PX / 2 - LOT_INSET_PX })
  }

  lot.parked = parkedOf(pack, { minute: at.minute, slots: lot.slots.length })
  lot.onDuty = lot.slots.length > 0 && isInRange(at.minute, pack.officeHours)
  lot.attendant.at.x = lot.post.x
  lot.attendant.at.y = lot.post.y
  lot.attendant.handing = false
  syncView(lot)
}

// Slots nearest the aisle first, the front row before the back one.
function layOut(
  slots: Point[],
  at: { readonly pack: RegionPack; readonly door: Point; readonly halfW: number }
): void {
  const far = sheltersOf(at.pack).filter((shelter) => shelter.stop.side === 'far')
  const isByShelter = (x: number): boolean =>
    far.some(
      (shelter) => x > shelter.x - SHELTER_CLEAR.before && x < shelter.x + SHELTER_CLEAR.after
    )

  for (let step = 0; AISLE_PX + PITCH_PX * (step + 0.5) < at.halfW; step++) {
    for (const [rowIndex, depth] of ROW_DEPTHS.entries()) {
      for (const side of [-1, 1]) {
        const x = at.door.x + side * (AISLE_PX + PITCH_PX * (step + 0.5))

        if (rowIndex > 0 || !isByShelter(x)) {
          slots.push({ x, y: NORTH.farTop + depth })
        }
      }
    }
  }
}

/** The lot through one step: the minute's count, and the attendant walking to the bike that came
 *  or went, handing the ticket, then back to the post. True while the attendant moves. */
export function stepLot(
  lot: Lot,
  at: {
    readonly pack: RegionPack
    readonly minute: number
    readonly nowMs: number
    readonly dt: number
  }
): boolean {
  const want = parkedOf(at.pack, { minute: at.minute, slots: lot.slots.length })

  lot.onDuty = lot.slots.length > 0 && isInRange(at.minute, at.pack.officeHours)

  if (want !== lot.parked) {
    lot.target = lot.slots[Math.max(want, lot.parked) - 1]
    lot.parked = want
  }

  const isMoving = lot.onDuty && walk(lot, at)

  syncView(lot)

  return isMoving
}

function walk(lot: Lot, at: { readonly nowMs: number; readonly dt: number }): boolean {
  const { attendant } = lot
  const goal = lot.target ?? lot.post
  const dx = goal.x - attendant.at.x
  const dy = goal.y - attendant.at.y
  const distance = Math.hypot(dx, dy)

  attendant.prev.x = attendant.at.x
  attendant.prev.y = attendant.at.y
  attendant.handing = at.nowMs < lot.handUntil

  if (attendant.handing) {
    return false
  }

  if (distance <= ARRIVED_PX) {
    if (lot.target !== undefined) {
      lot.target = undefined
      lot.handUntil = at.nowMs + TICKET_MS
    }

    return false
  }

  const reach = Math.min(1, (ATTENDANT_PX_PER_S * at.dt) / distance)

  attendant.at.x += dx * reach
  attendant.at.y += dy * reach

  return true
}

function syncView(lot: Lot): void {
  lot.view.parked = lot.parked
  lot.view.attendant = lot.onDuty ? lot.attendant : undefined
}

// The office day's bikes: they arrive over the arrival window, a few leave at lunch, most go over
// the leaving window and the rest by closing time.
function parkedOf(
  pack: RegionPack,
  at: { readonly minute: number; readonly slots: number }
): number {
  const { arrive, leave, nap } = pack.officeLife
  const closes = pack.officeHours[1]
  const { minute } = at
  let share = 0

  if (minute >= arrive[0] && minute < arrive[1]) {
    share = (minute - arrive[0]) / (arrive[1] - arrive[0])
  } else if (isInRange(minute, nap)) {
    share = LUNCH_SHARE
  } else if (minute >= arrive[1] && minute < leave[0]) {
    share = 1
  } else if (minute >= leave[0] && minute < leave[1]) {
    share = 1 - ((1 - EVENING_SHARE) * (minute - leave[0])) / (leave[1] - leave[0])
  } else if (minute >= leave[1] && minute < closes) {
    share = EVENING_SHARE * (1 - (minute - leave[1]) / (closes - leave[1]))
  }

  return Math.round(share * at.slots * FULL_SHARE)
}
