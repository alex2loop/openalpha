import type { Build } from '@/web/scene/render3d/props'
import type { Point } from '@/web/scene/types'
import { box } from '@/web/scene/render3d/boxes'
import {
  deskPhone,
  inTray,
  mug,
  type Place,
  pitcher,
  placard,
  studio,
} from '@/web/scene/render3d/desk-pieces'
import { METAL, PALETTE, PROP_TONES } from '@/web/scene/sprites/palette'
import { ELEVATION } from '@/web/scene/view'
import { type PropDef, propsOn } from '@/web/scene/world/props'

/** A monitor face in world px: 1.6 to 1, like the mockup's 320 by 200 screen. */
const MONITOR_FACE = Object.freeze({ w: 18, h: 11.25 })
/** Where a monitor's face starts: a seated head stays below the lower half of the screen. */
const MONITOR_BASE_PX = 19
/** The StandBy phone's lit screen, standing on its fold. */
const STANDBY_FACE = Object.freeze({ w: 14.6, h: 9.1 })
/** The desk calendar's page, leaning back on its stand. */
const CALENDAR_FACE = Object.freeze({ size: 7, tilt: -1.05 })

const SILVER = '#A3AAB8'
const KEYBOARD = '#F4F0E8'
const KEY_ROW = '#C9CDD6'
// The mockup's bin beside a junior desk's right end: body and rim.
const BIN = Object.freeze({ dx: 2.5, dz: 6, w: 4.4, h: 6, body: '#C5CEDD', rim: '#AEB9CC' })
const STANDBY_RIM = '#ECEEF2'
const STANDBY_GLASS = '#1B2552'
const STAMP = Object.freeze({ ink: '#C9505A', grip: '#9E7444' })
const DUCK = Object.freeze({ body: '#FFD65A', beak: '#F29B4B' })
const STICKY_TONES = ['#FFF4A8', '#FFC9DE', '#BFE3FF'] as const
const CALENDAR_STAND = '#2B2433'
const PAD = '#5D6577'
const BRASS = '#D9B25C'
const BANKER_VARIANT = 1
const BANKER_SHADE = Object.freeze({ off: '#5FA878', on: '#A8EBC0' })
// The mockup's small lights under the banker's green shade and the operator's desk lamp.
const BANKER_LIGHT = Object.freeze({ tone: 0x9cffc0, intensity: 14, distancePx: 80, heightPx: 35 })
const OPERATOR_LIGHT = Object.freeze({
  tone: 0xffd890,
  intensity: 10,
  distancePx: 80,
  heightPx: 22,
})
// Your desk's screens face you, the camera; its seat stands this far south of the computer's foot.
const SCREEN_SEAT_DZ = 8
// Every other desk's worker sits south of it, back to the camera, this far from its near edge.
const SITTER_GAP_PX = 10
// The monitor stands this far in from its desk's back edge, its face this far in front of that.
const MONITOR_BACK_INSET = 1
const MONITOR_FACE_PROUD = 1.2
const MONITOR_FACE_D = 0.3
// The back's centre sits this far behind the face.
const MONITOR_BACK_OUT = 0.7
// The mockup's lean: back from upright until the face looks straight at the camera.
const MONITOR_TILT = -(Math.PI / 2 - ELEVATION)
// The StandBy phone's upper half stands at 65 degrees on its fold, as the mockup's.
const STANDBY_TILT = -(25 * Math.PI) / 180
// A computer stands on the desk whose footprint holds it, give or take this.
const ON_DESK_SLACK_PX = 4
// The operator desk's top sits this high in the mockup; its pieces keep their rise above it.
const MOCKUP_TOP_PX = 14.5
const OPERATOR_ROOM = 'desk'
// The assistant's desk is the senior one: a StandBy phone stands where a junior keeps its mug.
const ASSISTANT_ROOM = 'assist'
const ALERT_ROOM = 'alerts'

/** A lamp on a desk: its shade's centre and size, and its tones off and lit. */
export interface DeskLamp {
  readonly room: PropDef['room']
  readonly at: readonly [x: number, y: number, z: number]
  readonly size: readonly [w: number, h: number, d: number]
  readonly off: string
  readonly on: string
  /** The point light it throws while lit, when it holds one of the four. */
  readonly light?: {
    readonly tone: number
    readonly intensity: number
    readonly distancePx: number
    readonly heightPx: number
  }
}

/** A monitor's face, where it lights and the seat whose worker lights it. */
export interface Screen {
  readonly at: readonly [x: number, y: number, z: number]
  readonly size: readonly [w: number, h: number, d: number]
  /** How far the face leans back, radians about x. */
  readonly tilt: number
  /** The monitor's back, leaning with its face. */
  readonly back: {
    readonly at: readonly [x: number, y: number, z: number]
    readonly size: readonly [w: number, h: number, d: number]
  }
  readonly seat: Point
  /** The computer's foot on the floor, where a desk piece names the monitor it covers. */
  readonly slot: Point
}

/** A box leaning back from upright by `tilt` (radians about x), round its centre. */
export interface Lean {
  readonly at: readonly [x: number, y: number, z: number]
  readonly size: readonly [w: number, h: number, d: number]
  readonly tilt: number
  readonly color: string
}

/** A small lit face on a desk, painted by `screen-faces`: its centre, size and lean. */
export interface DeskFace {
  readonly kind: 'calendar' | 'standby-clock' | 'standby-index' | 'standby-flow'
  readonly room: PropDef['room']
  readonly at: readonly [x: number, y: number, z: number]
  readonly size: readonly [w: number, h: number]
  readonly tilt: number
}

/** Where the operator's in-tray holds its stack: the floor corner of its inside and the height of
 *  its bottom. */
interface TraySpot {
  readonly x: number
  readonly z: number
  readonly y: number
}

/** What a desk carries besides its top and body: the operator's whole dressing, or a junior's
 *  keyboard and Mac Studio by its monitor. */
export function deskThings(job: Build): void {
  if (isOperatorDesk(job.prop)) {
    operatorThings(job)
    return
  }

  const computer = propsOn(job.prop.floor).find(
    (one) => one.kind === 'computer' && deskUnder(one)?.id === job.prop.id
  )

  // The alert counter carries its own pieces (`desk-items`) about its monitor.
  if (computer === undefined || job.prop.room === ALERT_ROOM) {
    return
  }

  juniorThings(job)

  const { x, y, w } = job.prop.rect
  const top = job.prop.height

  if (job.prop.room === ASSISTANT_ROOM) {
    standby(job, { x: x + w - 16, z: y + 0.5, top, kind: 'standby-flow' })
    return
  }

  deskPhone(job.out, { x: x + w - 13, z: y + 1, top, key: job.prop.id })
  mug(job.floor.mugs, { x: x + w - 5, z: y + 7, top })
}

/** A monitor on its silver stand at the back of its desk, its screen to the camera so the terminal
 *  reads: on your desk leaning back until its face looks at the camera; upright on every other,
 *  facing its worker, who sits south of the desk with their back to the camera. Its face and back
 *  are placed by `fixtures` so the face can light. */
export function monitorOf({ prop, out, floor }: Build): void {
  const cx = prop.rect.x + prop.rect.w / 2
  const desk = deskUnder(prop) ?? prop
  const isSitters = !isOperatorDesk(desk)
  const z = desk.rect.y + MONITOR_BACK_INSET
  const top = desk.height
  const tilt = isSitters ? 0 : MONITOR_TILT
  const { w, h } = MONITOR_FACE
  const pivot = { y: MONITOR_BASE_PX, z: z + MONITOR_FACE_PROUD }
  const face = leaned(pivot, { up: h / 2, out: MONITOR_FACE_D / 2 }, tilt)
  const back = leaned(pivot, { up: h / 2, out: -MONITOR_BACK_OUT }, tilt)

  out.push(
    box([cx - 0.9, z - 0.2, 1.8, 1.6, top, MONITOR_BASE_PX - top + 0.4], SILVER),
    box([cx - 3.5, z - 0.6, 7, 3, top, 0.8], SILVER, true)
  )
  floor.screens.push({
    at: [cx, face.y, face.z],
    size: [w, h, MONITOR_FACE_D],
    tilt,
    back: { at: [cx, back.y, back.z], size: [w + 0.8, h + 0.8, 1] },
    seat: isSitters
      ? { x: cx, y: desk.rect.y + desk.rect.h + SITTER_GAP_PX }
      : { x: cx, y: prop.rect.y + prop.rect.h + SCREEN_SEAT_DZ },
    slot: { x: cx, y: prop.rect.y + prop.rect.h },
  })
}

// A point `up` along a piece leaning back by `tilt` and `out` in front of it, from its foot.
function leaned(
  pivot: { readonly y: number; readonly z: number },
  local: { readonly up: number; readonly out: number },
  tilt: number
): { readonly y: number; readonly z: number } {
  const cos = Math.cos(tilt)
  const sin = Math.sin(tilt)

  return {
    y: pivot.y + local.up * cos - local.out * sin,
    z: pivot.z + local.up * sin + local.out * cos,
  }
}

/** The meeting table's papers, pad, glass, pitcher and cups, the role placards and two StandBy
 *  phones (one with the home index, one a clock). */
export function meetingThings({ prop, out, floor }: Build): void {
  const { x, y } = prop.rect
  const top = prop.height + 0.4

  out.push(
    box([x + 14, y + 5, 16, 10, top, 0.6], PALETTE.paper),
    box([x + 94, y + 5, 14, 10, top, 0.6], PALETTE.paper),
    box([x + 128, y + 6, 8, 6, top, 2], PAD, true),
    box([x + 60, y + 8, 3, 3, top, 3], PALETTE.paper, true)
  )
  pitcher(out, { x: x + 98, z: y + 9, top: top + 0.1 })

  for (const dx of [36, 68, 100]) {
    placard(out, { x: x + dx, z: y + 17, top: top + 0.1 })
  }

  for (const dx of [20, 52, 84, 116]) {
    placard(out, { x: x + dx, z: y + 3, top: top + 0.1 })
  }

  standby({ out, floor, prop }, { x: x + 58, z: y + 2, top: top + 0.1, kind: 'standby-index' })
  standby({ out, floor, prop }, { x: x + 112, z: y + 2, top: top + 0.1, kind: 'standby-clock' })
}

function isOperatorDesk(prop: PropDef): boolean {
  return prop.kind === 'desk' && prop.room === OPERATOR_ROOM
}

/** A desk lamp standing on its desk: the library's green banker's lamp (variant 1) or the
 *  operator's articulated lamp; its shade lights with the room and holds one of the four lights. */
export function deskLampOf({ prop, out, floor }: Build): void {
  const { x, y } = prop.rect
  const top = deskUnder(prop)?.height ?? 0

  if (prop.variant === BANKER_VARIANT) {
    out.push(
      box([x + 1, y + 1, 5, 5, top, 1.2], BRASS, true),
      box([x + 2.7, y + 2.7, 1.6, 1.6, top + 1.2, 3.5], BRASS)
    )
    floor.deskLamps.push({
      room: prop.room,
      at: [x + 3.5, top + 6, y + 3.5],
      size: [8, 3, 6],
      off: BANKER_SHADE.off,
      on: BANKER_SHADE.on,
      light: BANKER_LIGHT,
    })
    return
  }

  out.push(
    box([x, y + 0.5, 4, 4, top, 0.8], METAL[2], true),
    box([x + 1.5, y + 2, 1, 1, top + 0.8, 5.5], METAL[2]),
    box([x + 1.5, y + 2, 5, 1, top + 6, 0.9], METAL[2])
  )
  floor.deskLamps.push({
    room: prop.room,
    at: [x + 7, top + 5.9, y + 2.5],
    size: [5, 2.2, 4],
    off: PROP_TONES.lampOff,
    on: PROP_TONES.lampLit,
    light: OPERATOR_LIGHT,
  })
}

/** The operator's in-tray on its desk; absent where no floor carries the desk. */
export function operatorTrayOf(): TraySpot | undefined {
  const desk = propsOn('office').find(isOperatorDesk)

  if (desk === undefined) {
    return undefined
  }

  return { x: desk.rect.x + 3.2, z: desk.rect.y + 10.2, y: rise(desk, 14.8) }
}

// A mockup height on the operator desk, on this desk's own top.
function rise(desk: PropDef, mockupY: number): number {
  return desk.height + mockupY - MOCKUP_TOP_PX
}

// The desk or table whose footprint holds a computer's foot.
function deskUnder(computer: PropDef): PropDef | undefined {
  const cx = computer.rect.x + computer.rect.w / 2
  const foot = computer.rect.y + computer.rect.h

  return propsOn(computer.floor).find(
    (one) =>
      (one.kind === 'desk' || one.kind === 'table') &&
      isWithin(cx, one.rect.x, one.rect.w) &&
      foot >= one.rect.y - ON_DESK_SLACK_PX &&
      foot <= one.rect.y + one.rect.h + ON_DESK_SLACK_PX
  )
}

function isWithin(value: number, from: number, length: number): boolean {
  return value >= from && value <= from + length
}

// The mockup's operator desk: keyboard and paper, the Mac Studio, the StandBy flow phone, the
// in-tray, a stamp, a duck, sticky notes, the calendar and the desk lamp.
function operatorThings({ prop, out, floor }: Build): void {
  const { x, y } = prop.rect
  const at = (mockupY: number): number => rise(prop, mockupY)

  out.push(
    box([x + 30, y + 9, 14, 3.6, at(14.5), 1], KEYBOARD, true),
    box([x + 62, y + 10, 5, 3, at(14.5), 0.6], PALETTE.paper)
  )
  studio(out, { x: x + 84.5, z: y + 2.8, top: at(14.5) })
  standby({ out, floor, prop }, { x: x + 44, z: y + 2, top: at(14.5), kind: 'standby-flow' })
  inTray(out, { x: x + 2, z: y + 9, top: at(14) })
  out.push(
    box([x + 17, y + 10.5, 5, 5, at(14), 2], STAMP.ink, true),
    box([x + 18.5, y + 12, 2, 2, at(16), 4], STAMP.grip),
    box([x + 24, y + 10.5, 4.2, 3.4, at(14), 3], DUCK.body, true),
    box([x + 26.6, y + 10.7, 2.6, 2.6, at(16.6), 2.4], DUCK.body, true),
    box([x + 28.6, y + 11.5, 1.4, 1, at(17.4), 0.8], DUCK.beak)
  )
  STICKY_TONES.forEach((tone, i) => {
    out.push(box([x + 74 + i * 3.6, y + 9.5 + (i % 2) * 0.8, 3, 3, at(14), 0.4], tone))
  })
  calendar({ out, floor, prop }, { x: x + 63.4, z: y + 8.8, top: at(14.5) })
}

// The keyboard lies on the near half, before the worker sitting south of the desk.
function juniorThings({ prop, out }: Build): void {
  const { x, y, w } = prop.rect
  const top = prop.height

  out.push(
    box([x + w / 2 - 5, y + 6, 10, 4, top, 1], KEYBOARD, true),
    box([x + w / 2 - 5, y + 8, 10, 0.6, top + 0.9, 0.3], KEY_ROW),
    box([x + w + BIN.dx, y + BIN.dz, BIN.w, BIN.w, 0, BIN.h], BIN.body, true),
    box([x + w + BIN.dx - 0.3, y + BIN.dz - 0.3, BIN.w + 0.6, BIN.w + 0.6, BIN.h, 0.9], BIN.rim)
  )
  studio(out, { x: x + 3, z: y + 3.4, top })
}

// A phone open on its fold: the lower half flat, the upper half standing with its lit screen.
function standby(
  job: Pick<Build, 'out' | 'floor' | 'prop'>,
  at: Place & { readonly kind: DeskFace['kind'] }
): void {
  const { x, z, top } = at
  const fold = { y: top + 1.1, z: z + 6 }
  const slab = leaned(fold, { up: 5, out: 0 }, STANDBY_TILT)
  const face = leaned(fold, { up: 5, out: 0.58 }, STANDBY_TILT)

  job.out.push(
    box([x, z + 6, 16, 5, top, 1.1], STANDBY_RIM, true),
    box([x + 0.6, z + 6.4, 14.8, 4.2, top + 1.1, 0.05], STANDBY_GLASS)
  )
  job.floor.leans.push({
    at: [x + 8, slab.y, slab.z],
    size: [16, 10, 1.1],
    tilt: STANDBY_TILT,
    color: STANDBY_RIM,
  })
  job.floor.faces.push({
    kind: at.kind,
    room: job.prop.room,
    at: [x + 8, face.y, face.z],
    size: [STANDBY_FACE.w, STANDBY_FACE.h],
    tilt: STANDBY_TILT,
  })
}

function calendar(job: Pick<Build, 'out' | 'floor' | 'prop'>, at: Place): void {
  job.out.push(box([at.x, at.z, 7.2, 3, at.top, 0.9], CALENDAR_STAND))
  job.floor.faces.push({
    kind: 'calendar',
    room: job.prop.room,
    at: [at.x + 3.6, at.top + 3.2, at.z + 1.7],
    size: [CALENDAR_FACE.size, CALENDAR_FACE.size],
    tilt: CALENDAR_FACE.tilt,
  })
}
