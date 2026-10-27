import type { ActorId, FloorId, Point } from '@/web/scene/types'

/** What stands on a desk besides its furniture; the renderers draw each type their own way. */
export type DeskPropType =
  | 'reports'
  | 'highlighter'
  | 'monitor-candles'
  | 'monitor-line'
  | 'checklist'
  | 'plant'
  | 'photo'
  | 'headphones'
  | 'tabs'
  | 'note'
  | 'phone'
  | 'lamp'
  | 'cup'
  | 'sheet'

/** One piece on its owner's desk: where it stands on the floor and the height it stands at. */
export interface DeskProp {
  readonly owner: ActorId
  readonly type: DeskPropType
  readonly at: Point
  readonly height: number
}

type Spot = readonly [x: number, y: number, height?: number]
type Item = readonly [type: DeskPropType, x: number, y: number, height?: number]

interface DeskSpec {
  readonly items: readonly Item[]
  readonly cups: readonly Spot[]
  readonly sheets: readonly Spot[]
}

/** The cups and the sheets a desk has room for, filled in order as the day's work piles up. */
export const DESK_CUP_SLOTS = 3
export const DESK_SHEET_SLOTS = 6
/** The floor every desk that shows the day's work stands on. */
export const DESK_FLOOR: FloorId = 'office'

const SCREEN_TYPES: ReadonlySet<DeskPropType> = new Set(['monitor-candles', 'monitor-line', 'tabs'])
// The surfaces the pieces stand on: the meeting table, the library desks, the alert desk.
const MEET_TOP = 14
const LIB_TOP = 14
const ALERT_TOP = 15
// The planner has no desk: its notes and sheets are pinned on the library whiteboard's lower right.
const PLANNER: ActorId = 'planner'
const BOARD_NOTE_H = 13.4

export const DESK_PROPS: readonly DeskProp[] = Object.freeze([
  ...deskOf('analyst', MEET_TOP, {
    items: [
      ['reports', 455.5, 137.2],
      ['highlighter', 466.2, 139.4],
    ],
    cups: [
      [444.6, 135],
      [470, 141.6],
      [444, 128],
    ],
    sheets: [
      [449, 140],
      [446, 135.6],
      [461.8, 142],
      [443.4, 140],
      [453, 142.3],
      [447.6, 131],
    ],
  }),
  ...deskOf('trader', MEET_TOP, {
    items: [
      ['monitor-candles', 521, 136.4],
      ['monitor-line', 534.6, 136.4],
    ],
    cups: [
      [513.4, 141.4],
      [551.6, 136.4],
      [539.4, 129.6],
    ],
    sheets: [
      [545.8, 141.4],
      [550.4, 138.8],
      [541.6, 142.6],
      [549.8, 142.8],
      [545, 138.4],
      [517, 142.6],
    ],
  }),
  ...deskOf('risk', MEET_TOP, {
    items: [['checklist', 556.2, 135.6]],
    cups: [
      [578.6, 135.4],
      [570, 135.4],
      [581, 130],
    ],
    sheets: [
      [567.4, 139.4],
      [571.2, 142],
      [573.6, 137.2],
      [566.4, 142.6],
      [577, 140.4],
      [578.4, 143],
    ],
  }),
  ...deskOf('pm', MEET_TOP, {
    items: [
      ['plant', 516.4, 124.2],
      ['photo', 528, 129.6],
    ],
    cups: [
      [477, 127],
      [487.4, 130.2],
      [471, 136.6],
    ],
    sheets: [
      [484, 129.4],
      [478, 132.6],
      [473.6, 128.4],
      [489, 134],
      [481.6, 136],
      [473, 134.4],
    ],
  }),
  ...deskOf('crawler-1', LIB_TOP, {
    items: [
      ['headphones', 177, 119.4],
      ['tabs', 196, 151.5],
    ],
    cups: [
      [211.4, 121.2],
      [201.6, 121.6],
      [178.4, 130.4],
    ],
    sheets: [
      [188.2, 124.6],
      [188.6, 128.4],
      [186.4, 121],
      [204, 130],
      [182, 130.2],
      [201.6, 130.6],
    ],
  }),
  ...deskOf('crawler-2', LIB_TOP, {
    items: [
      ['headphones', 273, 119.4],
      ['tabs', 292, 151.5],
    ],
    cups: [
      [307.4, 121.2],
      [297.6, 121.6],
      [274.4, 130.4],
    ],
    sheets: [
      [284.2, 124.6],
      [284.6, 128.4],
      [282.4, 121],
      [300, 130],
      [278, 130.2],
      [297.6, 130.6],
    ],
  }),
  ...deskOf(PLANNER, BOARD_NOTE_H, {
    items: [
      ['note', 357, 85.4],
      ['note', 361.2, 85.4, 12.6],
      ['note', 365.4, 85.4, 13.8],
    ],
    cups: [],
    sheets: [
      [359, 85.4, 17],
      [363.4, 85.4, 16.4],
      [367.6, 85.4, 17.4],
      [355, 85.4, 17],
      [369.2, 85.4, 13],
      [353.4, 85.4, 13.2],
    ],
  }),
  ...deskOf('clerk', ALERT_TOP, {
    items: [
      ['phone', 214, 335.4],
      ['lamp', 247, 335.4],
    ],
    cups: [
      [182.4, 337.6],
      [279, 337],
      [240, 336],
    ],
    sheets: [
      [196, 337.6],
      [203.4, 340.4],
      [207.4, 336.4],
      [226, 340.6],
      [237, 341],
      [272, 339.4],
    ],
  }),
])

const SLOTS: ReadonlyMap<DeskProp, number> = slotsOf(DESK_PROPS)

/** A piece's place among its owner's pieces of its type: cups and sheets fill slots in this order. */
export function deskSlotOf(row: DeskProp): number {
  return SLOTS.get(row) ?? 0
}

/** A screen that shows the home index, a screensaver or a browser's tabs. */
export function isScreen(row: DeskProp): boolean {
  return SCREEN_TYPES.has(row.type)
}

/** A piece pinned upright on a board rather than lying on a desk. */
export function isPinned(row: DeskProp): boolean {
  return row.owner === PLANNER
}

function deskOf(owner: ActorId, height: number, spec: DeskSpec): DeskProp[] {
  const piece = (type: DeskPropType, [x, y, rise = height]: Spot): DeskProp => ({
    owner,
    type,
    at: { x, y },
    height: rise,
  })

  return [
    ...spec.items.map(([type, ...spot]) => piece(type, spot)),
    ...spec.cups.map((spot) => piece('cup', spot)),
    ...spec.sheets.map((spot) => piece('sheet', spot)),
  ]
}

function slotsOf(rows: readonly DeskProp[]): Map<DeskProp, number> {
  const counts = new Map<string, number>()

  return new Map(
    rows.map((row) => {
      const key = `${row.owner}|${row.type}`
      const slot = counts.get(key) ?? 0

      counts.set(key, slot + 1)

      return [row, slot]
    })
  )
}
