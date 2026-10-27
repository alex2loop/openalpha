import type { FloorId, Point, Rect, RoomId } from '@/web/scene/types'
import { DESK_SLOTS, FLOORS } from '@/web/scene/world/floors'
import { roomById } from '@/web/scene/world/rooms'

/** Everything the office draws besides its people and the desk items. */
export type PropKind =
  | 'desk'
  | 'chair'
  | 'shelf'
  | 'books'
  | 'computer'
  | 'printer'
  | 'copier'
  | 'rack'
  | 'tray'
  | 'box'
  | 'whiteboard'
  | 'results-board'
  | 'wall-screen'
  | 'clock'
  | 'frame'
  | 'phone'
  | 'table'
  | 'cooler'
  | 'coffee'
  | 'drinks'
  | 'vending'
  | 'sofa'
  | 'window'
  | 'plant'
  | 'lamp'
  | 'light-switch'
  | 'tank'
  | 'cat-bed'
  | 'guest-desk'
  | 'cabinet'
  | 'catalogue'
  | 'news-rack'
  | 'coat-rack'
  | 'ladder'
  | 'lift-door'
  | 'umbrella-stand'
  | 'bin'
  | 'gate-post'
  | 'podium'
  | 'desk-lamp'
  | 'cable-tray'
  | 'air-con'

/** The live figure a prop answers with on hover. */
export type TipSource =
  | 'shelf'
  | 'printer'
  | 'store'
  | 'meet'
  | 'results'
  | 'clock'
  | 'alerts'
  | 'agenda'
  | 'cat'
  | 'corgi'
  | 'fish'

/** Two boxes, one meaning each: `rect` is the footprint on the floor as the 3D layout stands it
 *  (the nav grid blocks it; a wall piece's is the wall area it hangs on), `draw` the box the 2D
 *  renderer paints and the pointer hits. `sortY` is the 2D paint order, `draw`'s bottom edge unless
 *  the piece stands on another and sorts with it;
 *  `height` how tall it stands (world px); `variant` picks a look among a kind's. */
export interface PropDef {
  readonly id: string
  readonly kind: PropKind
  readonly floor: FloorId
  readonly room: RoomId
  readonly rect: Rect
  readonly draw: Rect
  readonly height: number
  readonly sortY: number
  readonly tip?: TipSource
  readonly variant?: number
}

type Box = readonly [number, number, number, number]

interface PropLook {
  readonly height?: number
  /** The 2D paint order when it is not the drawn box's bottom: a monitor sorts with its desk. */
  readonly sortY?: number
  readonly tip?: TipSource
  readonly variant?: number
}

interface PropSpec extends PropLook {
  readonly kind: PropKind
  readonly room: RoomId
  readonly at: Box
  readonly draw: Box
}

/** How a seat's chair sits: at a desk, or facing the room's back or front wall. */
type SeatFacing = 'desk' | 'back' | 'front'

const HEIGHT_OF: Readonly<Record<PropKind, number>> = Object.freeze({
  desk: 14,
  chair: 12,
  shelf: 40,
  books: 6,
  computer: 23,
  printer: 12,
  copier: 27,
  rack: 36,
  tray: 6,
  box: 13,
  whiteboard: 30,
  'results-board': 22,
  'wall-screen': 24,
  clock: 12,
  frame: 12,
  phone: 2,
  table: 14,
  cooler: 43,
  coffee: 20,
  drinks: 11,
  vending: 40,
  sofa: 20,
  window: 28,
  plant: 16,
  lamp: 61,
  'light-switch': 9,
  tank: 18,
  'cat-bed': 2,
  'guest-desk': 15,
  cabinet: 32,
  catalogue: 23,
  'news-rack': 25,
  'coat-rack': 44,
  ladder: 34,
  'lift-door': 30,
  'umbrella-stand': 9,
  bin: 8,
  'gate-post': 16,
  podium: 18,
  'desk-lamp': 12,
  'cable-tray': 5,
  'air-con': 6,
} satisfies Record<PropKind, number>)

// Pieces hung on a wall: their `rect` is the wall area, nothing stands on it.
const WALL_KINDS: ReadonlySet<PropKind> = new Set([
  'air-con',
  'clock',
  'wall-screen',
  'whiteboard',
  'results-board',
  'frame',
  'light-switch',
  'lift-door',
  'window',
])

// Pieces hung under the ceiling: their `rect` is the floor they hang over, which stays walkable.
const OVERHEAD_KINDS: ReadonlySet<PropKind> = new Set(['cable-tray'])

// Pieces thin enough to pass beside: the nav grid blocks their footprint with no clearance, so the
// badge gates keep two lanes open through the west doorway.
const TIGHT_KINDS: ReadonlySet<PropKind> = new Set(['gate-post', 'podium'])

// A chair is an 11 px square centred on its seat, set back by its facing (the 3D chair3 and seatsOf).
const CHAIR_PX = 11
const CHAIR_SET_BACK: Readonly<Record<SeatFacing, number>> = Object.freeze({
  desk: 0,
  back: -4,
  front: -12,
})
// Hung under the ceiling: painted over everyone on the floor.
const OVERHEAD_SORT_Y = 10_000
const LIFT_OFFICE = FLOORS.office.lift
const LIFT_TEAM = FLOORS.team.lift

const PROP_SPECS: readonly PropSpec[] = Object.freeze([
  wall('frame', 'store', { at: [96, 8, 14, 11], variant: 2 }),
  wall('frame', 'store', { at: [122, 6, 18, 13], variant: 0 }),
  wall('wall-screen', 'store', { at: [44, 4, 40, 24], variant: 0 }),
  ...[0, 1, 2, 3, 4].map((i) =>
    stand('box', 'store', {
      at: [12 + i * 28, 52, 22, 12],
      draw: [12 + i * 28, 44, 22, 20],
      tip: 'store',
    })
  ),
  ...[0, 1, 2].map((i) =>
    stand('box', 'store', {
      at: [20 + i * 28, 78, 22, 12],
      draw: [20 + i * 28, 70, 22, 20],
      tip: 'store',
    })
  ),
  stand('rack', 'store', { at: [128, 100, 22, 12], draw: [128, 76, 22, 36] }),
  stand('table', 'store', {
    at: [100, 152, 30, 9],
    draw: [100, 150, 30, 12],
    height: 8,
    variant: 1,
  }),
  stand('box', 'store', {
    at: [104, 140, 18, 12],
    draw: [104, 138, 18, 14],
    height: 7,
    tip: 'store',
  }),
  stand('box', 'store', { at: [119, 174, 12, 10], draw: [119, 162, 12, 18], height: 20 }),
  stand('box', 'store', { at: [112, 174, 12, 10], draw: [112, 172, 12, 18], height: 10 }),
  stand('box', 'store', { at: [126, 174, 12, 10], draw: [126, 172, 12, 18], height: 10 }),
  stand('box', 'store', { at: [136, 176, 12, 10], draw: [136, 174, 12, 18], height: 10 }),
  stand('lamp', 'store', { at: [8, 180, 8, 8], draw: [6, 133, 12, 51] }),
  ...[60, 108].map((y) =>
    stand('cable-tray', 'store', {
      at: [8, y, 144, 5],
      draw: [8, y, 144, 5],
      sortY: OVERHEAD_SORT_Y,
    })
  ),
  stand('shelf', 'lib', { at: [174, 44, 64, 10], draw: [174, 14, 64, 40], tip: 'shelf' }),
  stand('shelf', 'lib', { at: [254, 44, 64, 10], draw: [254, 14, 64, 40], tip: 'shelf' }),
  wall('frame', 'lib', { at: [322, 6, 28, 18], variant: 3 }),
  wall('whiteboard', 'lib', { at: [328, 44, 44, 32], variant: 23 }),
  stand('ladder', 'lib', { at: [296, 56, 12, 3], draw: [296, 22, 11, 34] }),
  stand('books', 'lib', { at: [166, 72, 14, 10], draw: [166, 66, 15, 12], variant: 1 }),
  stand('books', 'lib', { at: [168, 98, 14, 10], draw: [168, 90, 15, 14], variant: 0 }),
  stand('catalogue', 'lib', { at: [168, 168, 28, 10], draw: [168, 156, 28, 22] }),
  ...[176, 224, 272].flatMap((x) => [
    stand('chair', 'lib', { at: seatFoot(x + 20, 136, 'desk'), draw: [x + 12, 113, 16, 11] }),
    stand('desk', 'lib', { at: [x, 119, 40, 12], draw: [x, 128, 40, 20] }),
    stand('computer', 'lib', { at: [x + 12, 128, 16, 3], draw: [x + 12, 119, 16, 14], sortY: 148 }),
  ]),
  stand('desk-lamp', 'lib', {
    at: [255, 120, 8, 4],
    draw: [254, 114, 10, 12],
    sortY: 149,
    variant: 1,
  }),
  stand('copier', 'lib', { at: [318, 142, 18, 14], draw: [318, 128, 24, 24] }),
  stand('printer', 'lib', { at: [334, 148, 22, 12], draw: [334, 140, 22, 18], tip: 'printer' }),
  stand('tray', 'lib', { at: [337, 160, 16, 5], draw: [336, 155, 18, 7] }),
  stand('plant', 'lib', { at: [362, 158, 8, 8], draw: [360, 150, 12, 16] }),
  stand('lamp', 'lib', { at: [368, 180, 8, 8], draw: [366, 133, 12, 51] }),
  stand('plant', 'meet', { at: [612, 48, 8, 8], draw: [610, 40, 12, 16] }),
  wall('air-con', 'meet', { at: [590, 5, 34, 6] }),
  wall('whiteboard', 'meet', { at: [398, 44, 40, 30], tip: 'meet', variant: 11 }),
  ...[480, 512, 544].map((x) =>
    stand('chair', 'meet', { at: seatFoot(x, 120, 'back'), draw: [x - 8, 97, 16, 11] })
  ),
  stand('table', 'meet', { at: [440, 122, 144, 22], draw: [440, 112, 144, 24] }),
  ...[464, 496, 528, 560].map((x) =>
    stand('chair', 'meet', {
      at: seatFoot(x, 172, 'front'),
      draw: [x - 8, 159, 16, 13],
      variant: 1,
    })
  ),
  stand('plant', 'meet', { at: [394, 158, 8, 8], draw: [392, 150, 12, 16] }),
  stand('drinks', 'meet', { at: [410, 172, 12, 8], draw: [410, 169, 12, 9] }),
  stand('lamp', 'meet', { at: [616, 162, 8, 8], draw: [614, 115, 12, 51] }),
  wall('lift-door', 'lobby', { at: [LIFT_OFFICE.x, LIFT_OFFICE.y, LIFT_OFFICE.w, LIFT_OFFICE.h] }),
  wall('light-switch', 'lobby', { at: [98, 232, 8, 11] }),
  ...[24, 56, 88].map((x, i) =>
    wall('clock', 'lobby', { at: [x, 226, 12, 12], tip: 'clock', variant: i })
  ),
  wall('wall-screen', 'lobby', { at: [28, 242, 84, 36], tip: 'agenda', variant: 1 }),
  wall('wall-screen', 'lobby', { at: [20, 286, 92, 42], tip: 'agenda', variant: 2 }),
  stand('coat-rack', 'lobby', { at: [146, 312, 8, 8], draw: [146, 272, 12, 45] }),
  stand('cooler', 'lobby', { at: [134, 292, 12, 8], draw: [134, 259, 12, 45] }),
  stand('coffee', 'lobby', { at: [114, 291, 16, 9], draw: [114, 280, 16, 19] }),
  stand('cat-bed', 'lobby', { at: [136, 315, 24, 14], draw: [136, 315, 24, 14] }),
  stand('umbrella-stand', 'lobby', { at: [6, 286, 6, 5], draw: [5, 272, 8, 19] }),
  stand('guest-desk', 'lobby', { at: [112, 323, 18, 10], draw: [112, 310, 18, 23] }),
  stand('chair', 'lobby', { at: seatFoot(121, 316, 'back'), draw: [113, 293, 16, 11] }),
  stand('bin', 'lobby', { at: [130, 301, 5, 5], draw: [130, 300, 5, 6] }),
  stand('gate-post', 'lobby', { at: [5, 254, 8, 3], draw: [5, 241, 8, 16] }),
  stand('podium', 'lobby', { at: [5, 264, 8, 8], draw: [5, 253, 8, 19] }),
  stand('gate-post', 'lobby', { at: [5, 279, 8, 3], draw: [5, 266, 8, 16] }),
  stand('sofa', 'lobby', { at: [24, 354, 72, 14], draw: [24, 340, 72, 30] }),
  stand('plant', 'lobby', { at: [136, 352, 8, 8], draw: [134, 344, 12, 16] }),
  stand('lamp', 'lobby', { at: [100, 368, 8, 8], draw: [98, 321, 12, 51] }),
  wall('frame', 'alerts', { at: [232, 230, 16, 12], variant: 1 }),
  wall('wall-screen', 'alerts', { at: [174, 260, 42, 24], tip: 'alerts', variant: 3 }),
  wall('wall-screen', 'alerts', { at: [226, 236, 56, 8], variant: 4 }),
  stand('news-rack', 'alerts', { at: [300, 262, 14, 6], draw: [300, 246, 14, 20] }),
  stand('cabinet', 'alerts', { at: [286, 298, 26, 6], draw: [286, 266, 26, 38] }),
  stand('plant', 'alerts', { at: [172, 270, 8, 8], draw: [170, 262, 12, 16] }),
  stand('desk', 'alerts', {
    at: [176, 333, 108, 10],
    draw: [176, 322, 108, 20],
    height: 15,
    tip: 'alerts',
    variant: 1,
  }),
  stand('phone', 'alerts', { at: [258, 334, 10, 8], draw: [258, 323, 10, 7], height: 19.5 }),
  stand('lamp', 'alerts', { at: [308, 372, 8, 8], draw: [306, 325, 12, 51] }),
  wall('results-board', 'assist', { at: [414, 232, 52, 22], tip: 'results' }),
  stand('chair', 'assist', { at: seatFoot(384, 306, 'desk'), draw: [376, 283, 16, 11] }),
  stand('desk', 'assist', { at: [364, 291, 40, 12], draw: [364, 300, 40, 20], variant: 3 }),
  stand('computer', 'assist', { at: [376, 300, 16, 3], draw: [376, 291, 16, 14], sortY: 320 }),
  stand('tank', 'assist', { at: [434, 298, 36, 13], draw: [434, 295, 36, 27], tip: 'fish' }),
  stand('plant', 'assist', { at: [332, 348, 8, 8], draw: [330, 340, 12, 16] }),
  stand('plant', 'assist', { at: [452, 352, 8, 8], draw: [450, 344, 12, 16] }),
  stand('lamp', 'assist', { at: [464, 266, 8, 8], draw: [462, 219, 12, 51] }),
  wall('frame', 'desk', { at: [560, 230, 18, 13], variant: 0 }),
  wall('clock', 'desk', { at: [496, 236, 12, 12], tip: 'clock' }),
  stand('plant', 'desk', { at: [612, 270, 8, 8], draw: [610, 262, 12, 16] }),
  stand('desk', 'desk', { at: [510, 308, 96, 14], draw: [510, 300, 96, 22], variant: 2 }),
  stand('bin', 'desk', { at: [604, 323, 5, 5], draw: [604, 322, 5, 6] }),
  stand('desk-lamp', 'desk', { at: [512, 309, 6, 4], draw: [511, 296, 14, 14], sortY: 323 }),
  stand('computer', 'desk', { at: [526, 319, 16, 3], draw: [526, 291, 16, 14], sortY: 322 }),
  stand('computer', 'desk', { at: [574, 319, 16, 3], draw: [574, 291, 16, 14], sortY: 322 }),
  stand('lamp', 'desk', { at: [618, 350, 8, 8], draw: [616, 303, 12, 51] }),
  wall('lift-door', 'team', { at: [LIFT_TEAM.x, LIFT_TEAM.y, LIFT_TEAM.w, LIFT_TEAM.h] }),
  ...DESK_SLOTS.flatMap(({ x, y }) => [
    stand('chair', 'team', { at: seatFoot(x + 20, y + 8, 'desk'), draw: [x + 12, y - 15, 16, 11] }),
    stand('desk', 'team', { at: [x, y - 9, 40, 12], draw: [x, y, 40, 20] }),
    stand('computer', 'team', {
      at: [x + 12, y, 16, 3],
      draw: [x + 12, y - 9, 16, 14],
      sortY: y + 20,
    }),
  ]),
  stand('shelf', 'team', { at: [520, 66, 48, 10], draw: [520, 40, 48, 36], height: 36 }),
  stand('shelf', 'team', { at: [576, 66, 48, 10], draw: [576, 40, 48, 36], height: 36 }),
  ...[76, 236, 396].map((x, i) => wall('frame', 'team', { at: [x, 8, 16, 12], variant: i })),
  wall('clock', 'team', { at: [300, 10, 12, 12], tip: 'clock' }),
  stand('table', 'team', { at: [512, 118, 92, 12], draw: [512, 120, 92, 18] }),
  stand('vending', 'team', { at: [620, 232, 18, 12], draw: [620, 206, 18, 38] }),
  stand('sofa', 'team', { at: [528, 242, 84, 14], draw: [528, 228, 84, 30] }),
  stand('coffee', 'team', {
    at: [522, 310, 40, 12],
    draw: [522, 288, 40, 34],
    height: 26,
    variant: 1,
  }),
  stand('drinks', 'team', { at: [582, 290, 16, 9], draw: [582, 297, 12, 9] }),
  stand('cooler', 'team', { at: [604, 312, 12, 8], draw: [604, 279, 12, 45] }),
  ...[
    [616, 112],
    [500, 350],
    [8, 40],
    [470, 40],
  ].map(([x = 0, y = 0]) =>
    stand('plant', 'team', { at: [x + 2, y + 8, 8, 8], draw: [x, y, 12, 16] })
  ),
  stand('lamp', 'team', { at: [508, 250, 8, 8], draw: [506, 203, 12, 51] }),
])

const PROPS: readonly PropDef[] = Object.freeze(PROP_SPECS.map(toProp))

/** The wet-floor sign and the bucket at its right, as one footprint about the sign's foot. */
const WET_SIGN = Object.freeze({ left: 3.5, w: 14, h: 5 })

/** The dark mat inside the street exit, flat on the floor, where nothing is blocked. */
export const EXIT_MAT: Rect = Object.freeze({ x: 3, y: 254, w: 16, h: 28 })

export function propsOn(floor: FloorId): readonly PropDef[] {
  return PROPS.filter((prop) => prop.floor === floor)
}

export function isWallMounted(prop: PropDef): boolean {
  return WALL_KINDS.has(prop.kind)
}

/** A piece hung under the ceiling: nothing blocks under it and the 2D floor paints it over all. */
export function isOverhead(prop: PropDef): boolean {
  return OVERHEAD_KINDS.has(prop.kind)
}

/** A piece walkers may brush past: its footprint blocks with no clearance round it. */
export function isTight(prop: PropDef): boolean {
  return TIGHT_KINDS.has(prop.kind)
}

/** The cleaner's wet-floor sign with its bucket beside it, standing at `at` (the sign's foot). */
export function wetSignRectOf(at: Point): Rect {
  return { x: at.x - WET_SIGN.left, y: at.y - WET_SIGN.h, w: WET_SIGN.w, h: WET_SIGN.h }
}

export function isPropKind(value: string): value is PropKind {
  return Object.hasOwn(HEIGHT_OF, value)
}

function toProp(spec: PropSpec, index: number): PropDef {
  const [x, y, w, h] = spec.at
  const [dx, dy, dw, dh] = spec.draw

  return {
    id: `${spec.room}-${spec.kind}-${index}`,
    kind: spec.kind,
    floor: roomById(spec.room)?.floor ?? 'office',
    room: spec.room,
    rect: { x, y, w, h },
    draw: { x: dx, y: dy, w: dw, h: dh },
    height: spec.height ?? HEIGHT_OF[spec.kind],
    sortY: spec.sortY ?? dy + dh,
    ...(spec.tip === undefined ? {} : { tip: spec.tip }),
    ...(spec.variant === undefined ? {} : { variant: spec.variant }),
  }
}

// A piece standing on the floor: its 3D footprint and its 2D drawn box differ.
function stand(
  kind: PropKind,
  room: RoomId,
  spec: PropLook & { readonly at: Box; readonly draw: Box }
): PropSpec {
  return { kind, room, ...spec }
}

// A piece hung on a wall: one box serves both.
function wall(kind: PropKind, room: RoomId, spec: PropLook & { readonly at: Box }): PropSpec {
  return { kind, room, draw: spec.at, ...spec }
}

function seatFoot(x: number, y: number, facing: SeatFacing): Box {
  const cy = y + CHAIR_SET_BACK[facing]

  return [x - CHAIR_PX / 2, cy - CHAIR_PX / 2, CHAIR_PX, CHAIR_PX]
}
