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

/** `rect` is the piece as it stands on the floor, `sortY` its bottom edge, `height` how tall it
 *  stands (world px); `variant` picks a look among a kind's (a frame's art, a screen's content). */
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
  readonly tip?: TipSource
  readonly variant?: number
}

const HEIGHT_OF: Readonly<Record<PropKind, number>> = Object.freeze({
  desk: 14.5,
  chair: 12,
  shelf: 40,
  books: 6,
  computer: 9,
  printer: 12,
  copier: 20,
  rack: 36,
  tray: 4,
  box: 12,
  whiteboard: 30,
  'results-board': 22,
  'wall-screen': 24,
  clock: 12,
  frame: 12,
  phone: 2,
  table: 13,
  cooler: 26,
  coffee: 18,
  drinks: 8,
  vending: 40,
  sofa: 12,
  window: 28,
  plant: 16,
  lamp: 56,
  'light-switch': 9,
  tank: 18,
  'cat-bed': 3,
  'guest-desk': 15,
  cabinet: 32,
  catalogue: 22,
  'news-rack': 20,
  'coat-rack': 44,
  ladder: 34,
  'lift-door': 30,
} satisfies Record<PropKind, number>)

const LIFT_OFFICE = FLOORS.office.lift
const LIFT_TEAM = FLOORS.team.lift

const PROP_SPECS: readonly PropSpec[] = Object.freeze([
  { kind: 'frame', room: 'store', at: [96, 8, 14, 11], variant: 2 },
  { kind: 'frame', room: 'store', at: [122, 6, 18, 13], variant: 0 },
  { kind: 'wall-screen', room: 'store', at: [44, 4, 40, 24], variant: 0 },
  ...[0, 1, 2, 3, 4].map(
    (i): PropSpec => ({ kind: 'box', room: 'store', at: [12 + i * 28, 44, 22, 20], tip: 'store' })
  ),
  ...[0, 1, 2].map(
    (i): PropSpec => ({ kind: 'box', room: 'store', at: [20 + i * 28, 70, 22, 20], tip: 'store' })
  ),
  { kind: 'rack', room: 'store', at: [128, 76, 22, 36] },
  { kind: 'table', room: 'store', at: [100, 150, 30, 12], variant: 1 },
  { kind: 'box', room: 'store', at: [104, 138, 18, 14], tip: 'store' },
  { kind: 'box', room: 'store', at: [119, 162, 12, 18] },
  { kind: 'box', room: 'store', at: [112, 172, 12, 18] },
  { kind: 'box', room: 'store', at: [126, 172, 12, 18] },
  { kind: 'box', room: 'store', at: [136, 174, 12, 18] },
  { kind: 'lamp', room: 'store', at: [6, 133, 12, 51] },
  { kind: 'shelf', room: 'lib', at: [174, 14, 64, 40], tip: 'shelf' },
  { kind: 'shelf', room: 'lib', at: [254, 14, 64, 40], tip: 'shelf' },
  { kind: 'frame', room: 'lib', at: [322, 6, 28, 18], variant: 3 },
  { kind: 'whiteboard', room: 'lib', at: [328, 44, 44, 32], variant: 23 },
  { kind: 'ladder', room: 'lib', at: [296, 22, 11, 34] },
  { kind: 'books', room: 'lib', at: [166, 66, 15, 12], variant: 1 },
  { kind: 'books', room: 'lib', at: [168, 90, 15, 14], variant: 0 },
  { kind: 'catalogue', room: 'lib', at: [168, 156, 28, 22] },
  ...[176, 224, 272].flatMap((x): PropSpec[] => [
    { kind: 'chair', room: 'lib', at: [x + 12, 113, 16, 11] },
    { kind: 'desk', room: 'lib', at: [x, 128, 40, 20] },
    { kind: 'computer', room: 'lib', at: [x + 12, 114, 16, 14] },
  ]),
  { kind: 'copier', room: 'lib', at: [318, 128, 24, 24] },
  { kind: 'printer', room: 'lib', at: [334, 140, 22, 18], tip: 'printer' },
  { kind: 'tray', room: 'lib', at: [336, 155, 18, 7] },
  { kind: 'plant', room: 'lib', at: [360, 150, 12, 16] },
  { kind: 'lamp', room: 'lib', at: [366, 133, 12, 51] },
  { kind: 'plant', room: 'meet', at: [610, 40, 12, 16] },
  { kind: 'whiteboard', room: 'meet', at: [398, 44, 40, 30], tip: 'meet', variant: 11 },
  ...[480, 512, 544].map(
    (x): PropSpec => ({ kind: 'chair', room: 'meet', at: [x - 8, 97, 16, 11] })
  ),
  { kind: 'table', room: 'meet', at: [440, 112, 144, 24] },
  ...[464, 496, 528, 560].map(
    (x): PropSpec => ({ kind: 'chair', room: 'meet', at: [x - 8, 159, 16, 13], variant: 1 })
  ),
  { kind: 'plant', room: 'meet', at: [392, 150, 12, 16] },
  { kind: 'drinks', room: 'meet', at: [410, 169, 12, 9] },
  { kind: 'lamp', room: 'meet', at: [614, 115, 12, 51] },
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
  { kind: 'coat-rack', room: 'lobby', at: [146, 272, 12, 45] },
  { kind: 'cooler', room: 'lobby', at: [134, 276, 12, 24] },
  { kind: 'coffee', room: 'lobby', at: [114, 280, 16, 19] },
  { kind: 'cat-bed', room: 'lobby', at: [136, 315, 24, 14] },
  { kind: 'guest-desk', room: 'lobby', at: [112, 310, 18, 23] },
  { kind: 'sofa', room: 'lobby', at: [24, 340, 72, 30] },
  { kind: 'plant', room: 'lobby', at: [134, 344, 12, 16] },
  { kind: 'lamp', room: 'lobby', at: [98, 321, 12, 51] },
  { kind: 'frame', room: 'alerts', at: [232, 230, 16, 12], variant: 1 },
  { kind: 'wall-screen', room: 'alerts', at: [174, 260, 42, 24], tip: 'alerts', variant: 3 },
  { kind: 'wall-screen', room: 'alerts', at: [226, 236, 56, 8], variant: 4 },
  { kind: 'news-rack', room: 'alerts', at: [300, 246, 14, 20] },
  { kind: 'cabinet', room: 'alerts', at: [286, 266, 26, 38] },
  { kind: 'plant', room: 'alerts', at: [170, 262, 12, 16] },
  { kind: 'desk', room: 'alerts', at: [176, 322, 108, 20], tip: 'alerts', variant: 1 },
  { kind: 'phone', room: 'alerts', at: [258, 323, 10, 7] },
  { kind: 'lamp', room: 'alerts', at: [306, 325, 12, 51] },
  { kind: 'results-board', room: 'assist', at: [414, 232, 52, 22], tip: 'results' },
  { kind: 'chair', room: 'assist', at: [376, 283, 16, 11] },
  { kind: 'desk', room: 'assist', at: [364, 300, 40, 20] },
  { kind: 'computer', room: 'assist', at: [376, 286, 16, 14] },
  { kind: 'tank', room: 'assist', at: [434, 295, 36, 27] },
  { kind: 'plant', room: 'assist', at: [330, 340, 12, 16] },
  { kind: 'plant', room: 'assist', at: [450, 344, 12, 16] },
  { kind: 'lamp', room: 'assist', at: [462, 219, 12, 51] },
  { kind: 'frame', room: 'desk', at: [560, 230, 18, 13], variant: 0 },
  { kind: 'clock', room: 'desk', at: [496, 236, 12, 12], tip: 'clock' },
  { kind: 'plant', room: 'desk', at: [610, 262, 12, 16] },
  { kind: 'desk', room: 'desk', at: [510, 300, 96, 22], variant: 2 },
  { kind: 'computer', room: 'desk', at: [526, 286, 16, 14] },
  { kind: 'computer', room: 'desk', at: [574, 286, 16, 14] },
  { kind: 'lamp', room: 'desk', at: [616, 303, 12, 51] },
  { kind: 'lift-door', room: 'team', at: [LIFT_TEAM.x, LIFT_TEAM.y, LIFT_TEAM.w, LIFT_TEAM.h] },
  { kind: 'shelf', room: 'team', at: [520, 40, 48, 36] },
  { kind: 'shelf', room: 'team', at: [576, 40, 48, 36] },
  ...[76, 236, 396].map(
    (x, i): PropSpec => ({ kind: 'frame', room: 'team', at: [x, 8, 16, 12], variant: i })
  ),
  { kind: 'clock', room: 'team', at: [300, 10, 12, 12], tip: 'clock' },
  { kind: 'table', room: 'team', at: [512, 120, 92, 18] },
  { kind: 'vending', room: 'team', at: [620, 206, 18, 38] },
  { kind: 'sofa', room: 'team', at: [528, 228, 84, 30] },
  { kind: 'coffee', room: 'team', at: [522, 288, 40, 34], variant: 1 },
  { kind: 'drinks', room: 'team', at: [582, 297, 12, 9] },
  { kind: 'cooler', room: 'team', at: [604, 296, 12, 24] },
  ...[
    [616, 112],
    [500, 350],
    [8, 40],
    [470, 40],
  ].map(([x = 0, y = 0]): PropSpec => ({ kind: 'plant', room: 'team', at: [x, y, 12, 16] })),
  { kind: 'lamp', room: 'team', at: [506, 203, 12, 51] },
])

/** Every prop on both floors, its footprint in world pixels. */
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
    height: HEIGHT_OF[spec.kind],
    sortY: y + h,
    ...(spec.tip === undefined ? {} : { tip: spec.tip }),
    ...(spec.variant === undefined ? {} : { variant: spec.variant }),
  }
}
