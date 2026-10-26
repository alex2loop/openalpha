import type { DeskPropType } from '@/web/scene/world/desk-props'
import { OUTLINE, PALETTE } from '@/web/scene/sprites/palette'

/** One box of a desk piece, from the piece's spot: x and depth offsets, width, depth, rise above
 *  the surface and height in world px, and its colour. Both renderers build it the same. */
export type ShapeBox = readonly [
  dx: number,
  dz: number,
  w: number,
  d: number,
  rise: number,
  h: number,
  color: string,
]

/** A face from the atlas on a piece: upright towards the camera (`size` its height) or lying on
 *  the desk (`size` its depth). */
interface FaceSpot {
  readonly dx: number
  readonly dz: number
  readonly w: number
  readonly size: number
  readonly rise: number
  readonly isUpright: boolean
}

const REPORT_COVER = '#9AB5D6'
const MONITOR_TONE = '#A3AAB8'

/** A cup on the desk, filled in its slot's tone, coffee showing at its top. */
export const CUP_LOOK = Object.freeze({
  w: 3,
  h: 3.2,
  coffee: '#4A2C17',
  tones: ['#FFFFFF', '#F29BB6', '#7DB7E8'] as const,
})
/** A sheet lying on the desk, each slot at its own turn. */
export const SHEET_LOOK = Object.freeze({
  w: 5.2,
  d: 3.8,
  h: 0.2,
  tones: ['#FBF9F3', '#F1EEE4', '#FFFFFF'] as const,
  turns: [0.25, -0.3, 0.1, 0.5, -0.12, 0.4],
})
/** A sticky note, or a sheet pinned on a board. */
export const NOTE_LOOK = Object.freeze({
  w: 3.8,
  h: 3.8,
  d: 0.2,
  tones: ['#FFF4A8', '#FFC9DE', '#BFE3FF', '#CFF2C9'] as const,
})
/** The alert desk lamp's dome: amber while an alert is unread. */
export const LAMP_DOME = Object.freeze({
  dx: 0.7,
  dz: 0.7,
  w: 3,
  rise: 1,
  h: 2.6,
  on: '#FFB340',
  off: '#8A6A3A',
})
/** The static boxes of each piece type. */
export const DESK_SHAPES: Readonly<Partial<Record<DeskPropType, readonly ShapeBox[]>>> =
  Object.freeze({
    reports: [0, 1, 2, 3].map(
      (i): ShapeBox => [(i % 2) * 0.4, (i * 0.3) % 0.9, 9, 6.4, i * 0.75, 0.75, reportTone(i)]
    ),
    highlighter: [
      [0, 0, 6, 1.3, 0, 1.3, '#F7E26B'],
      [4.6, -0.1, 1.6, 1.5, 0, 1.5, '#3E8A7E'],
    ],
    headphones: [
      [0, 0, 1.5, 2.4, 0.6, 2.4, '#5C6E90'],
      [4.4, 0, 1.5, 2.4, 0.6, 2.4, '#5C6E90'],
      [0.5, 0.9, 4.9, 0.6, 3, 0.6, OUTLINE],
    ],
    plant: [
      [0, 0, 5, 5, 0, 3, '#C9845A'],
      [0.6, 0.6, 3.8, 3.8, 3, 3.2, '#5FA872'],
      [1, 1, 3, 3, 6.2, 2.6, '#8CCB98'],
      [-0.8, 1.4, 2.2, 2.2, 4.6, 2, '#3E7E52'],
      [3.6, 1.2, 2.2, 2.2, 5, 2.2, '#3E7E52'],
    ],
    phone: [[0, 0, 4.2, 8.2, 0, 0.7, '#3A3F4F']],
    lamp: [[0, 0, 4.4, 4.4, 0, 1, '#8A919E']],
    checklist: [[-0.6, -0.6, 8.2, 9.2, 0, 0.5, '#C9A86A']],
    photo: [[-3.3, -0.4, 6.6, 1.8, 0, 0.4, '#8E6238']],
    'monitor-candles': monitorShapes(),
    'monitor-line': monitorShapes(),
  })
/** Where each piece shows its face; a tab strip shows over its desk's own monitor instead. */
export const DESK_FACES: Readonly<Partial<Record<DeskPropType, FaceSpot>>> = Object.freeze({
  'monitor-candles': { dx: -5.2, dz: 0, w: 10.4, size: 8.3, rise: 3.4, isUpright: true },
  'monitor-line': { dx: -5.2, dz: 0, w: 10.4, size: 8.3, rise: 3.4, isUpright: true },
  photo: { dx: -3, dz: 0, w: 6, size: 5.8, rise: 0.4, isUpright: true },
  checklist: { dx: 0, dz: 0, w: 7, size: 8, rise: 0.54, isUpright: false },
  phone: { dx: 0.3, dz: 0.5, w: 3.6, size: 7.2, rise: 0.74, isUpright: false },
})

/** The turn a sheet in this slot lies at, clockwise in the 2D picture. */
export function sheetTurnOf(slot: number): number {
  return SHEET_LOOK.turns[slot % SHEET_LOOK.turns.length] ?? 0
}

/** The tone a slot takes from a look's tones, round the list. */
export function toneOf(tones: readonly [string, ...string[]], slot: number): string {
  return tones[slot % tones.length] ?? tones[0]
}

function reportTone(layer: number): string {
  return layer === 3 ? REPORT_COVER : PALETTE.paper
}

// A monitor's stand and foot; its face is the atlas's.
function monitorShapes(): readonly ShapeBox[] {
  return [
    [-0.8, -0.5, 1.6, 1.6, 0, 3.4, MONITOR_TONE],
    [-3.4, -1, 6.8, 3, 0, 0.6, MONITOR_TONE],
  ]
}
