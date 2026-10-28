import type { Heading, VendorView } from '@/web/scene/street-types'
import { type Bike, createBike, placeBike, stepBike } from '@/web/scene/sim/street/flower-bike'
import {
  addPoint,
  clearRoute,
  createPed,
  PAVEMENT,
  type Ped,
  SIDE_WALKS,
  startOn,
  syncGait,
  takePed,
  WALK_REACH_PX,
  type WalkTick,
  walkPed,
} from '@/web/scene/sim/street/ped-walk'
import { type Point, type Rect, WORLD } from '@/web/scene/types'
import { isWithin, type RegionPack, type VendorId } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { isInside } from '@/web/scene/world/rooms'
import { NORTH, sideX } from '@/web/scene/world/street-layout'

/** The stools on the far pavement and their cart, by the stool row's west end (`x0`): the morning
 *  phở and evening stools east of the shop row, and the evening stools by the crossing. */
export const STOOL_ROWS = Object.freeze({
  pho: { x0: 566, seats: [1.8, 6, 10.3, 14.6], cart: 22.5 },
  crossing: { x0: -50, seats: [1.8, 6, 10.3, 14.6], cart: 22.2 },
})
/** The stool row's seats and table, and the cart behind it, in world y. */
export const STOOL_ROW_Y = Object.freeze({
  seat: NORTH.farTop + 4,
  table: NORTH.farTop + 6.6,
  cart: NORTH.farTop + 4.6,
})
/** The iced tea corner at the east side street's pavement: the lane people come along, and its
 *  three stools. */
export const TEA_CORNER = Object.freeze({
  lane: sideX(1, SIDE_WALKS.near),
  seats: [
    { x: WORLD.w + 16.2, y: 4.4, facing: 'east', via: undefined },
    { x: WORLD.w + 22.2, y: 4.4, facing: 'west', via: 2.2 },
    { x: WORLD.w + 16.2, y: 9.6, facing: 'east', via: undefined },
  ],
} as const)
/** The bánh mì glass cart on the far pavement, clear of the park gates, the pigeons and the doors. */
export const BANH_MI_CART = Object.freeze({ x: 80, y: PAVEMENT.farKerb - 0.8 })
/** Everyone at the vendors' stools at once: every stool taken. */
const MAX_VENDOR_PEOPLE = 11
const ARRIVE_CHANCE = 0.015
const STAY_MS = Object.freeze({ min: 25_000, span: 95_000 })
// People come along the far pavement from this far east or west of the stool row.
const ROW_FROM_PX = Object.freeze({ east: 95, west: -80 })
const ROW_LANE_DX = -4
const ROW_BEHIND_DY = -1.4
// One puff of steam climbs from the pot this long; the pot's rim on the cart's west half.
const STEAM_MS = 2_100
const POT = Object.freeze({ dx: -0.9, dy: -5.4 })

type Rng = ReturnType<typeof createRng>

/** What a stool site is doing now. */
type SiteMode = 'pho' | 'evening' | 'tea' | undefined

/** A stool someone can take: where it is, which way its sitter faces, and the way in. */
interface Seat {
  readonly x: number
  readonly y: number
  readonly facing: Heading
  readonly via: number | undefined
}

/** A site's stools and the vendors that run it, in the order the sim fills them. */
interface Site {
  readonly id: 'pho' | 'crossing' | 'tea'
  readonly seats: readonly Seat[]
}

/** Someone at a vendor's stools: the site and stool, until when they sit, and whether they are
 *  coming, sitting or going. */
interface VendorPed extends Ped {
  site: number
  seat: number
  until: number
  stage: 'go' | 'sit' | 'leave'
}

/** The pavement's vendors: the stool sites' sitters, the flower bicycle, and what the painter
 *  reads of them. */
export interface Vendors {
  readonly pool: VendorPed[]
  readonly tick: WalkTick
  readonly bike: Bike
  readonly view: VendorView & { bike: Bike | undefined; pot: Point | undefined; steam: number }
  rng: Rng
}

/** What a vendors step reads: the pack, the page minute, sim time and the seconds stepped. */
interface VendorStep {
  readonly pack: RegionPack
  readonly minute: number
  readonly nowMs: number
  readonly dt: number
}

const SITES: readonly Site[] = Object.freeze([
  { id: 'pho', seats: rowSeatsOf(STOOL_ROWS.pho) },
  { id: 'crossing', seats: rowSeatsOf(STOOL_ROWS.crossing) },
  { id: 'tea', seats: TEA_CORNER.seats },
])
const PHO_POT: Point = Object.freeze({
  x: STOOL_ROWS.pho.x0 + STOOL_ROWS.pho.cart + POT.dx,
  y: STOOL_ROW_Y.cart + POT.dy,
})

export function createVendors(): Vendors {
  return {
    pool: Array.from({ length: MAX_VENDOR_PEOPLE }, createVendorPed),
    tick: { dt: 0, nowMs: 0, canCross: false },
    bike: createBike(),
    view: { bike: undefined, pot: undefined, steam: 0 },
    rng: createRng(0),
  }
}

/** What the stool site `id` runs at `minute`, by the pack's vendors and their hours. */
export function siteModeOf(id: Site['id'], pack: RegionPack, minute: number): SiteMode {
  if (id === 'tea') {
    return isOpen(pack, 'tea', minute) ? 'tea' : undefined
  }

  if (id === 'pho' && isOpen(pack, 'pho', minute)) {
    return 'pho'
  }

  return isOpen(pack, 'eveningStools', minute) ? 'evening' : undefined
}

/** The vendor runs in the pack and its hours hold `minute`. */
export function isOpen(pack: RegionPack, id: VendorId, minute: number): boolean {
  return pack.vendors.includes(id) && isWithin(pack.hours.vendors[id], minute)
}

/** Rebuilds the vendors from the clock: each open site's stools taken, the flower bicycle
 *  stopped somewhere along its way while its hours hold. */
export function resetVendors(
  vendors: Vendors,
  at: {
    readonly pack: RegionPack
    readonly day: string
    readonly minute: number
    readonly nowMs: number
  }
): void {
  vendors.rng = createRng(seedOf(at.day, at.pack.id, 'vendors', String(Math.floor(at.minute))))

  for (const ped of vendors.pool) {
    ped.on = false
  }

  for (const [index, site] of SITES.entries()) {
    for (let seat = 0; seat < wantOf(site, at); seat++) {
      const ped = takeSeat(vendors, { site: index, seat })

      if (ped !== undefined) {
        sitDown(vendors, ped, at.nowMs)
      }
    }
  }

  placeBike(vendors.bike, {
    rng: vendors.rng,
    isOpen: isOpen(at.pack, 'flowerBike', at.minute),
    nowMs: at.nowMs,
  })
  syncView(vendors, at)
}

/** One sim step: people come to free stools, sit a while and leave, the bicycle rides on and
 *  stops, the steam climbs. */
export function stepVendors(vendors: Vendors, at: VendorStep): void {
  vendors.tick.dt = at.dt
  vendors.tick.nowMs = at.nowMs

  for (let index = 0; index < SITES.length; index++) {
    arriveAt(vendors, { index, step: at })
  }

  for (const ped of vendors.pool) {
    if (ped.on) {
      stepSitter(vendors, ped, at)
      syncGait(ped, at.nowMs)
    }
  }

  stepBike(vendors.bike, {
    rng: vendors.rng,
    isOpen: isOpen(at.pack, 'flowerBike', at.minute),
    nowMs: at.nowMs,
    dt: at.dt,
  })
  syncView(vendors, at)
}

/** Something of the vendors moves within `rect`: the bicycle riding there, or steam over a pot. */
export function isVendorMovingIn(vendors: Vendors, rect: Rect): boolean {
  const { bike, pot } = vendors.view
  const isRiding = bike !== undefined && bike.prev.x !== bike.at.x && isInside(rect, bike.at)

  return isRiding || (pot !== undefined && isInside(rect, pot))
}

function createVendorPed(): VendorPed {
  return { ...createPed(), site: -1, seat: -1, until: 0, stage: 'go' }
}

function rowSeatsOf(row: { readonly x0: number; readonly seats: readonly number[] }): Seat[] {
  return row.seats.map((dx) => ({
    x: row.x0 + dx,
    y: STOOL_ROW_Y.seat,
    facing: 'south',
    via: undefined,
  }))
}

// Every stool at phở and the evening stools; at the tea corner one free outside the rush hours.
function wantOf(site: Site, at: { readonly pack: RegionPack; readonly minute: number }): number {
  const mode = siteModeOf(site.id, at.pack, at.minute)

  if (mode === undefined) {
    return 0
  }

  return mode === 'tea' && !isWithin(at.pack.hours.rush, at.minute)
    ? site.seats.length - 1
    : site.seats.length
}

// Now and then someone walks in to a free stool of an open site that is not yet full.
function arriveAt(
  vendors: Vendors,
  at: { readonly index: number; readonly step: VendorStep }
): void {
  const site = SITES[at.index]

  if (site === undefined || takenAt(vendors, at.index) >= wantOf(site, at.step)) {
    return
  }

  if (vendors.rng.next() >= ARRIVE_CHANCE) {
    return
  }

  const seat = vendors.rng.int(0, site.seats.length - 1)
  const ped = isSeatTaken(vendors, at.index, seat)
    ? undefined
    : takeSeat(vendors, { site: at.index, seat })

  if (ped !== undefined) {
    walkIn(vendors, ped, site)
    startOn(vendors, ped, { nowMs: at.step.nowMs, isPlaced: false })
  }
}

function takenAt(vendors: Vendors, site: number): number {
  let count = 0

  for (const ped of vendors.pool) {
    count += ped.on && ped.site === site ? 1 : 0
  }

  return count
}

function isSeatTaken(vendors: Vendors, site: number, seat: number): boolean {
  return vendors.pool.some((ped) => ped.on && ped.site === site && ped.seat === seat)
}

function takeSeat(
  vendors: Vendors,
  at: { readonly site: number; readonly seat: number }
): VendorPed | undefined {
  const seat = SITES[at.site]?.seats[at.seat]
  const ped = seat === undefined ? undefined : takePed(vendors, seat)

  if (ped !== undefined) {
    ped.site = at.site
    ped.seat = at.seat
    ped.stage = 'go'
  }

  return ped
}

// Along the far pavement and behind the stools to a row's seat; down the side pavement to the tea
// corner's, round the table to the far one.
function walkIn(vendors: Vendors, ped: VendorPed, site: Site): void {
  const seat = site.seats[ped.seat]

  if (seat === undefined) {
    return
  }

  clearRoute(ped)

  if (site.id === 'tea') {
    addPoint(ped, TEA_CORNER.lane, PAVEMENT.sideTop)
    addPoint(ped, TEA_CORNER.lane, seat.via ?? seat.y)
    addPoint(ped, seat.x, seat.via ?? seat.y)
  } else {
    const lane = rowLaneOf(site)
    const isEast = vendors.rng.next() < 0.5
    const from = lane + (isEast ? ROW_FROM_PX.east : ROW_FROM_PX.west)

    addPoint(ped, Math.max(-WALK_REACH_PX, Math.min(WORLD.w + WALK_REACH_PX, from)), PAVEMENT.far)
    addPoint(ped, lane, PAVEMENT.far)
    addPoint(ped, lane, STOOL_ROW_Y.seat + ROW_BEHIND_DY)
    addPoint(ped, seat.x, STOOL_ROW_Y.seat + ROW_BEHIND_DY)
  }

  addPoint(ped, seat.x, seat.y)
}

// Out the way they came, to the far pavement's end or down the side pavement.
function walkOut(vendors: Vendors, ped: VendorPed): void {
  const site = SITES[ped.site]
  const seat = site?.seats[ped.seat]

  ped.stage = 'leave'
  ped.kind = 'walker'
  clearRoute(ped)

  if (site === undefined || seat === undefined) {
    return
  }

  if (site.id === 'tea') {
    addPoint(ped, seat.x, seat.via ?? seat.y)
    addPoint(ped, TEA_CORNER.lane, seat.via ?? seat.y)
    addPoint(ped, TEA_CORNER.lane, PAVEMENT.south)
    return
  }

  const lane = rowLaneOf(site)

  addPoint(ped, seat.x, STOOL_ROW_Y.seat + ROW_BEHIND_DY)
  addPoint(ped, lane, STOOL_ROW_Y.seat + ROW_BEHIND_DY)
  addPoint(ped, lane, PAVEMENT.far)
  addPoint(ped, vendors.rng.next() < 0.5 ? -WALK_REACH_PX : WORLD.w + WALK_REACH_PX, PAVEMENT.far)
}

function rowLaneOf(site: Site): number {
  return (site.seats[0]?.x ?? 0) + ROW_LANE_DX
}

// Walking in or out; seated until their time is up or the site packs away.
function stepSitter(vendors: Vendors, ped: VendorPed, step: VendorStep): void {
  const site = SITES[ped.site]
  const isOpenNow = site !== undefined && siteModeOf(site.id, step.pack, step.minute) !== undefined

  if (ped.stage === 'sit') {
    if (step.nowMs >= ped.until || !isOpenNow) {
      walkOut(vendors, ped)
    }

    return
  }

  if (!walkPed(ped, vendors.tick)) {
    return
  }

  if (ped.stage === 'leave') {
    ped.on = false
  } else {
    sitDown(vendors, ped, step.nowMs)
  }
}

function sitDown(vendors: Vendors, ped: VendorPed, nowMs: number): void {
  const seat = SITES[ped.site]?.seats[ped.seat]

  clearRoute(ped)
  ped.stage = 'sit'
  ped.kind = 'sitter'
  ped.facing = seat?.facing ?? 'south'
  ped.until = nowMs + STAY_MS.min + vendors.rng.next() * STAY_MS.span
}

function syncView(
  vendors: Vendors,
  at: { readonly pack: RegionPack; readonly minute: number; readonly nowMs: number }
): void {
  const { view } = vendors

  view.bike = vendors.bike.on ? vendors.bike : undefined
  view.pot = siteModeOf('pho', at.pack, at.minute) === 'pho' ? PHO_POT : undefined
  view.steam = (at.nowMs % STEAM_MS) / STEAM_MS
}
