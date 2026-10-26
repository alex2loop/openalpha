import type { DeskFace } from '@/web/scene/render3d/desk-dressing'
import type { FloorProps } from '@/web/scene/render3d/props'
import type { FloorId, RoomId } from '@/web/scene/types'
import { formatDay } from '@/i18n'
import { pageMinute } from '@/web/scene/clock/clock'
import { homeIndex, ledItems } from '@/web/scene/data/led'
import { debateStepOf, questionNumberOf, roomStatus } from '@/web/scene/data/room-status'
import {
  paintBoard,
  paintCalendar,
  paintClock,
  paintStandBy,
  paintTape,
  type StandByView,
  type TapeRow,
} from '@/web/scene/render3d/face-paint'
import { wallSpotsOf } from '@/web/scene/render3d/wall-spots'
import { faceKindOf } from '@/web/scene/sprites/screens'
import { type PropDef, propsOn } from '@/web/scene/world/props'
import { quotesBlock } from '@/web/state/market'
import { locale } from '@/web/state/session'
import { formatFixed, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { formatHourOfDay } from '@/web/text/time'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'

/** The alert desk's price board is wall screen variant 3. */
const TAPE_VARIANT = 3
const TAPE_ROWS = 4
// Under this many CSS px a tape row cannot be read, and the board shows the up and down counts.
const MIN_ROW_PX = 9
const INDEX_DIGITS = 2
const DAY_DIGITS_FROM = 8
// A face stands this far in front of the plate it covers, so the two never share a plane.
const FACE_LIFT_PX = 0.06
const STANDBY_VIEWS = Object.freeze({
  'standby-clock': 'clock',
  'standby-index': 'index',
  'standby-flow': 'flow',
} as const satisfies Record<StandByKind, StandByView['view']>)

type StandByKind = Exclude<DeskFace['kind'], 'calendar'>

/** A face painted from the page's data: what it shows, where it stands and how it takes light. */
export interface InfoFace {
  readonly kind: 'board' | 'tape' | 'clock' | DeskFace['kind']
  readonly room: RoomId
  readonly at: readonly [x: number, y: number, z: number]
  readonly size: readonly [w: number, h: number]
  readonly tilt: number
  /** A screen glows in its own colours; paper and a clock take the room's light. */
  readonly isGlowing: boolean
  /** The north wall a hung face fades with. */
  readonly wallAt?: { readonly x: number; readonly wallZ: number }
  readonly seed: number
}

/** A face's signature now and the painter that draws it. */
interface InfoJob {
  readonly key: string
  readonly paint: (c: CanvasRenderingContext2D) => void
}

/** The floor's data faces: whiteboards, the alert desk's price board and the wall clocks, plus the
 *  StandBy phones and the calendar on desks. A prop the shared face painters already cover is left
 *  to them. */
export function infoFacesOf(floor: FloorId, props: FloorProps | undefined): InfoFace[] {
  const onWalls = propsOn(floor).flatMap((prop) => {
    const kind = wallKindOf(prop)

    return kind === undefined ? [] : [wallFace(prop, kind)]
  })
  const onDesks = (props?.faces ?? []).map(
    (face): InfoFace => ({ ...face, isGlowing: face.kind !== 'calendar', seed: 0 })
  )

  return [...onWalls, ...onDesks]
}

/** Everything the data faces read, by reference: while none moved, no face needs asking again. */
export function infoInputsOf(scale: number): readonly unknown[] {
  return [
    scale,
    pageMinute.value,
    roomStatus.value,
    ledItems.value,
    homeIndex.value,
    quotesBlock.view.value,
    locale.value,
  ]
}

/** What `face` shows this frame, at `scale` CSS px per world px. */
export function infoJobOf(face: InfoFace, scale: number): InfoJob {
  switch (face.kind) {
    case 'board': {
      const count = boardCountOf(face.room)

      return { key: count ?? '', paint: (c) => paintBoard(c, { count, seed: face.seed }) }
    }
    case 'tape': {
      const rows = tapeRows()
      const isTiny = (face.size[1] / Math.max(1, rows.length)) * scale < MIN_ROW_PX

      return { key: JSON.stringify([rows, isTiny]), paint: (c) => paintTape(c, { rows, isTiny }) }
    }
    case 'clock': {
      const { minute } = pageMinute.value

      return { key: `${minute}`, paint: (c) => paintClock(c, minute) }
    }
    case 'calendar': {
      const day = String(Number(pageMinute.value.day.slice(DAY_DIGITS_FROM)))

      return { key: day, paint: (c) => paintCalendar(c, day) }
    }
    default: {
      const view = standByOf(face.kind)

      return { key: JSON.stringify(view), paint: (c) => paintStandBy(c, view) }
    }
  }
}

function wallKindOf(prop: PropDef): 'board' | 'tape' | 'clock' | undefined {
  if (faceKindOf(prop) !== undefined) {
    return undefined
  }

  if (prop.kind === 'whiteboard') {
    return 'board'
  }

  if (prop.kind === 'clock') {
    return 'clock'
  }

  return prop.kind === 'wall-screen' && prop.variant === TAPE_VARIANT ? 'tape' : undefined
}

function wallFace(prop: PropDef, kind: 'board' | 'tape' | 'clock'): InfoFace {
  const spots = wallSpotsOf(prop)
  const [x, z, w, d, y, h] = spots.face

  return {
    kind,
    room: prop.room,
    at: [x + w / 2, y + h / 2, z + d + FACE_LIFT_PX],
    size: [w, h],
    tilt: 0,
    isGlowing: kind === 'tape',
    ...(spots.wallZ === undefined ? {} : { wallAt: { x: prop.rect.x, wallZ: spots.wallZ } }),
    seed: prop.variant ?? 0,
  }
}

// The counter the room's whiteboard holds while a run works there.
function boardCountOf(room: RoomId): string | undefined {
  const run = roomStatus.value.get(room)?.runs[0]

  if (room === 'meet') {
    return debateStepOf(run)
  }

  return room === 'lib' ? questionNumberOf(run) : undefined
}

// The tape's first rows, as the strip under the header lists them: the benchmarks, then the
// watchlist names they do not already carry.
function tapeRows(): readonly TapeRow[] {
  const benchmarks = ledItems.value.map((item) => toRow(item.label, item.changePct))
  const named = new Set(benchmarks.map((row) => row.name))
  const watched = (quotesBlock.view.value.data?.quotes ?? [])
    .filter((quote) => !named.has(quote.ticker))
    .map((quote) => toRow(quote.ticker, quote.changePct))

  return [...benchmarks, ...watched].slice(0, TAPE_ROWS)
}

function toRow(name: string, changePct: number | undefined): TapeRow {
  return { name, move: formatSignedPercent(changePct), tone: toneOfPercent(changePct) }
}

function standByOf(kind: StandByKind): StandByView {
  const { minute, day } = pageMinute.value
  const index = homeIndex.value
  const view = STANDBY_VIEWS[kind]

  return {
    view,
    time: formatHourOfDay(minute / MINUTES_PER_HOUR),
    date: formatDay(locale.value, day),
    minute,
    ...(view !== 'index' || index === undefined
      ? {}
      : {
          index: {
            label: index.label,
            level: formatFixed(index.level, INDEX_DIGITS),
            move: toRow(index.label, index.changePct),
          },
        }),
  }
}
