import type { FloorId, Rect, RoomId } from '@/web/scene/types'
import { FLOORS } from '@/web/scene/world/floors'
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

/** A floor-standing piece's `rect` is its footprint on the floor and `height` how tall it stands
 *  (world px), so the nav grid blocks exactly what it covers; a wall-mounted piece's `rect` is the
 *  area it hangs on in the wall band. `sortY` is the rect's bottom edge; `variant` picks a look among
 *  a kind's (a frame's art, a screen's content). */
export interface PropDef {
  readonly id: string
  readonly kind: PropKind
  readonly floor: FloorId
  readonly room: RoomId
  readonly rect: Rect
  readonly height: number
  readonly sortY: number
  readonly tip?: TipSource
  readonly variant?: number
}

interface PropSpec {
  readonly kind: PropKind
  readonly room: RoomId
  readonly at: readonly [number, number, number, number]
  readonly height?: number
  readonly tip?: TipSource
  readonly variant?: number
}

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
} satisfies Record<PropKind, number>)

// Hung on a wall: `rect` is the wall area, not a footprint, and nothing stands in front of it.
const WALL_KINDS: ReadonlySet<PropKind> = new Set([
  'frame',
  'wall-screen',
  'whiteboard',
  'results-board',
  'clock',
  'light-switch',
  'lift-door',
  'window',
])
/** How far one px of height rises on screen in the fixed oblique view both renderers share. */
const RISE_PER_HEIGHT = 0.78
const LIFT_OFFICE = FLOORS.office.lift
const LIFT_TEAM = FLOORS.team.lift

// Footprints from the 3D layout where it and the 2D mockup differ.
const PROP_SPECS: readonly PropSpec[] = Object.freeze([
  { kind: 'frame', room: 'store', at: [96, 8, 14, 11], variant: 2 },
  { kind: 'frame', room: 'store', at: [122, 6, 18, 13], variant: 0 },
  { kind: 'wall-screen', room: 'store', at: [44, 4, 40, 24], variant: 0 },
  ...[0, 1, 2, 3, 4].map(
    (i): PropSpec => ({ kind: 'box', room: 'store', at: [12 + i * 28, 52, 22, 12], tip: 'store' })
  ),
  ...[0, 1, 2].map(
    (i): PropSpec => ({ kind: 'box', room: 'store', at: [20 + i * 28, 78, 22, 12], tip: 'store' })
  ),
  { kind: 'rack', room: 'store', at: [128, 100, 22, 12] },
  { kind: 'table', room: 'store', at: [100, 152, 30, 9], height: 8, variant: 1 },
  { kind: 'box', room: 'store', at: [104, 140, 18, 12], height: 7, tip: 'store' },
  { kind: 'box', room: 'store', at: [119, 164, 12, 10], height: 20 },
  { kind: 'box', room: 'store', at: [112, 174, 12, 10], height: 10 },
  { kind: 'box', room: 'store', at: [126, 174, 12, 10], height: 10 },
  { kind: 'box', room: 'store', at: [136, 176, 12, 10], height: 10 },
  { kind: 'lamp', room: 'store', at: [8, 180, 8, 8] },
  { kind: 'shelf', room: 'lib', at: [174, 44, 64, 10], tip: 'shelf' },
  { kind: 'shelf', room: 'lib', at: [254, 44, 64, 10], tip: 'shelf' },
  { kind: 'frame', room: 'lib', at: [322, 6, 28, 18], variant: 3 },
  { kind: 'whiteboard', room: 'lib', at: [328, 44, 44, 32], variant: 23 },
  { kind: 'ladder', room: 'lib', at: [296, 56, 12, 3] },
  { kind: 'books', room: 'lib', at: [166, 72, 13, 6], variant: 1 },
  { kind: 'books', room: 'lib', at: [168, 98, 14, 6], variant: 0 },
  { kind: 'catalogue', room: 'lib', at: [168, 168, 28, 10] },
  ...[176, 224, 272].flatMap((x): PropSpec[] => [
    { kind: 'chair', room: 'lib', at: [x + 13, 126, 14, 10] },
    { kind: 'desk', room: 'lib', at: [x, 119, 40, 12] },
    { kind: 'computer', room: 'lib', at: [x + 12, 128, 16, 3] },
  ]),
  { kind: 'copier', room: 'lib', at: [318, 142, 18, 14] },
  { kind: 'printer', room: 'lib', at: [334, 148, 22, 12], tip: 'printer' },
  { kind: 'tray', room: 'lib', at: [337, 160, 16, 5] },
  { kind: 'plant', room: 'lib', at: [362, 158, 8, 8] },
  { kind: 'lamp', room: 'lib', at: [368, 180, 8, 8] },
  { kind: 'plant', room: 'meet', at: [612, 48, 8, 8] },
  { kind: 'whiteboard', room: 'meet', at: [398, 44, 40, 30], tip: 'meet', variant: 11 },
  ...[480, 512, 544].map(
    (x): PropSpec => ({ kind: 'chair', room: 'meet', at: [x - 7, 110, 14, 10] })
  ),
  { kind: 'table', room: 'meet', at: [440, 122, 144, 22] },
  ...[464, 496, 528, 560].map(
    (x): PropSpec => ({ kind: 'chair', room: 'meet', at: [x - 7, 162, 14, 10], variant: 1 })
  ),
  { kind: 'plant', room: 'meet', at: [394, 158, 8, 8] },
  { kind: 'drinks', room: 'meet', at: [410, 172, 12, 8] },
  { kind: 'lamp', room: 'meet', at: [616, 162, 8, 8] },
  {
    kind: 'lift-door',
    room: 'lobby',
    at: [LIFT_OFFICE.x, LIFT_OFFICE.y, LIFT_OFFICE.w, LIFT_OFFICE.h],
  },
  { kind: 'light-switch', room: 'lobby', at: [98, 232, 8, 11] },
  ...[24, 56, 88].map(
    (x): PropSpec => ({ kind: 'clock', room: 'lobby', at: [x, 226, 12, 12], tip: 'clock' })
  ),
  { kind: 'wall-screen', room: 'lobby', at: [28, 242, 84, 36], tip: 'agenda', variant: 1 },
  { kind: 'wall-screen', room: 'lobby', at: [20, 286, 92, 42], tip: 'agenda', variant: 2 },
  { kind: 'coat-rack', room: 'lobby', at: [146, 312, 8, 8] },
  { kind: 'cooler', room: 'lobby', at: [134, 292, 12, 8] },
  { kind: 'coffee', room: 'lobby', at: [114, 291, 16, 9] },
  { kind: 'cat-bed', room: 'lobby', at: [136, 315, 24, 14] },
  { kind: 'guest-desk', room: 'lobby', at: [112, 323, 18, 10] },
  { kind: 'sofa', room: 'lobby', at: [24, 354, 72, 14] },
  { kind: 'plant', room: 'lobby', at: [136, 352, 8, 8] },
  { kind: 'lamp', room: 'lobby', at: [100, 368, 8, 8] },
  { kind: 'frame', room: 'alerts', at: [232, 230, 16, 12], variant: 1 },
  { kind: 'wall-screen', room: 'alerts', at: [174, 260, 42, 24], tip: 'alerts', variant: 3 },
  { kind: 'wall-screen', room: 'alerts', at: [226, 236, 56, 8], variant: 4 },
  { kind: 'news-rack', room: 'alerts', at: [300, 262, 14, 6] },
  { kind: 'cabinet', room: 'alerts', at: [286, 298, 26, 6] },
  { kind: 'plant', room: 'alerts', at: [172, 270, 8, 8] },
  { kind: 'desk', room: 'alerts', at: [176, 333, 108, 10], height: 15, tip: 'alerts', variant: 1 },
  { kind: 'phone', room: 'alerts', at: [258, 334, 10, 8], height: 19.5 },
  { kind: 'lamp', room: 'alerts', at: [308, 372, 8, 8] },
  { kind: 'results-board', room: 'assist', at: [414, 232, 52, 22], tip: 'results' },
  { kind: 'chair', room: 'assist', at: [377, 296, 14, 10] },
  { kind: 'desk', room: 'assist', at: [364, 291, 40, 12] },
  { kind: 'computer', room: 'assist', at: [376, 300, 16, 3] },
  { kind: 'tank', room: 'assist', at: [434, 298, 36, 13] },
  { kind: 'plant', room: 'assist', at: [332, 348, 8, 8] },
  { kind: 'plant', room: 'assist', at: [452, 352, 8, 8] },
  { kind: 'lamp', room: 'assist', at: [464, 266, 8, 8] },
  { kind: 'frame', room: 'desk', at: [560, 230, 18, 13], variant: 0 },
  { kind: 'clock', room: 'desk', at: [496, 236, 12, 12], tip: 'clock' },
  { kind: 'plant', room: 'desk', at: [612, 270, 8, 8] },
  { kind: 'desk', room: 'desk', at: [510, 308, 96, 14], variant: 2 },
  { kind: 'computer', room: 'desk', at: [526, 319, 16, 3] },
  { kind: 'computer', room: 'desk', at: [574, 319, 16, 3] },
  { kind: 'lamp', room: 'desk', at: [618, 350, 8, 8] },
  { kind: 'lift-door', room: 'team', at: [LIFT_TEAM.x, LIFT_TEAM.y, LIFT_TEAM.w, LIFT_TEAM.h] },
  { kind: 'shelf', room: 'team', at: [520, 66, 48, 10], height: 36 },
  { kind: 'shelf', room: 'team', at: [576, 66, 48, 10], height: 36 },
  ...[76, 236, 396].map(
    (x, i): PropSpec => ({ kind: 'frame', room: 'team', at: [x, 8, 16, 12], variant: i })
  ),
  { kind: 'clock', room: 'team', at: [300, 10, 12, 12], tip: 'clock' },
  { kind: 'table', room: 'team', at: [512, 118, 92, 12] },
  { kind: 'vending', room: 'team', at: [620, 232, 18, 12] },
  { kind: 'sofa', room: 'team', at: [528, 242, 84, 14] },
  { kind: 'coffee', room: 'team', at: [522, 310, 40, 12], height: 26, variant: 1 },
  { kind: 'drinks', room: 'team', at: [582, 300, 12, 8] },
  { kind: 'cooler', room: 'team', at: [604, 314, 12, 8] },
  ...[
    [616, 112],
    [500, 350],
    [8, 40],
    [470, 40],
  ].map(([x = 0, y = 0]): PropSpec => ({ kind: 'plant', room: 'team', at: [x + 2, y + 8, 8, 8] })),
  { kind: 'lamp', room: 'team', at: [508, 250, 8, 8] },
])

const PROPS: readonly PropDef[] = Object.freeze(PROP_SPECS.map(toProp))

export function propsOn(floor: FloorId): readonly PropDef[] {
  return PROPS.filter((prop) => prop.floor === floor)
}

function toProp(spec: PropSpec, index: number): PropDef {
  const [x, y, w, h] = spec.at

  return {
    id: `${spec.room}-${spec.kind}-${index}`,
    kind: spec.kind,
    floor: roomById(spec.room)?.floor ?? 'office',
    room: spec.room,
    rect: { x, y, w, h },
    height: spec.height ?? HEIGHT_OF[spec.kind],
    sortY: y + h,
    ...(spec.tip === undefined ? {} : { tip: spec.tip }),
    ...(spec.variant === undefined ? {} : { variant: spec.variant }),
  }
}

/** What the piece covers on screen in a flat view: a wall piece its wall area; a standing piece its
 *  footprint plus the height rising above it. Drawing and pointer hits both read it. */
export function spriteRectOf(prop: PropDef): Rect {
  if (WALL_KINDS.has(prop.kind)) {
    return prop.rect
  }

  const rise = Math.round(prop.height * RISE_PER_HEIGHT)

  return { x: prop.rect.x, y: prop.rect.y - rise, w: prop.rect.w, h: prop.rect.h + rise }
}
