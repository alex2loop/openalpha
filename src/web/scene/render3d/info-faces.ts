import type { DeskFace } from '@/web/scene/render3d/desk-dressing'
import type { FloorProps } from '@/web/scene/render3d/props'
import type { FloorId, RoomId, SimView } from '@/web/scene/types'
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
import { isNightSun } from '@/web/scene/render3d/light-model'
import {
  type SignFace,
  type SignFrame,
  signFacesOf,
  signInputsOf,
  signJobOf,
} from '@/web/scene/render3d/sign-faces'
import { wallSpotsOf } from '@/web/scene/render3d/wall-spots'
import { faceKindOf } from '@/web/scene/sprites/screens'
import { type PropDef, propsOn } from '@/web/scene/world/props'
import { quotesBlock } from '@/web/state/market'
import { notices } from '@/web/state/notices'
import { reducedMotion } from '@/web/state/prefs'
import { locale } from '@/web/state/session'
import { formatFixed, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { toNoticeText } from '@/web/text/notice'
import { formatHourOfDay } from '@/web/text/time'
import { MINUTES_PER_HOUR, MS_PER_SECOND } from '@/web/text/time-units'

/** The alert desk's price board is wall screen variant 3. */
const TAPE_VARIANT = 3
const TAPE_ROWS = 4
// Under this many CSS px a tape row cannot be read, and the board shows the up and down counts.
const MIN_ROW_PX = 9
const INDEX_DIGITS = 2
const DAY_DIGITS_FROM = 8
// The StandBy phones that carry the operator's notices: your desk's and the assistant's.
const BANNER_ROOMS: ReadonlySet<RoomId> = new Set(['desk', 'assist'])
// The mockup's banner stays this long; the flow drifts in steps of this.
const BANNER_MS = 4_000
const FLOW_STEP_MS = 200
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
  readonly kind: 'board' | 'tape' | 'clock' | DeskFace['kind'] | SignFace['kind']
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

/** What the faces read from the frame besides the page's signals: the lift, whether the office is
 *  quiet (StandBy screens dim) and whether it is night (they turn red). */
export interface FaceMood extends SignFrame {
  readonly isQuiet: boolean
  readonly isNight: boolean
  /** Seconds of the StandBy flow's drift, in its steps; 0 under reduced motion. */
  readonly flowSeconds: number
  /** The newest notice's title while it is fresh. */
  readonly banner?: string
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
  const signs = signFacesOf(floor).map(
    (face): InfoFace => ({ ...face, isGlowing: face.kind !== 'plaque', seed: 0 })
  )

  return [...onWalls, ...onDesks, ...signs]
}

/** What the faces read from this frame's snapshot, the page's notices and the clock. */
export function faceMoodOf(sim: SimView): FaceMood {
  const newest = notices.value[0]
  const isFresh = newest !== undefined && Date.now() - newest.createdAt < BANNER_MS
  const banner = isFresh ? toNoticeText(newest.event)?.title : undefined
  const flowStep = Math.floor(performance.now() / FLOW_STEP_MS) * FLOW_STEP_MS

  return {
    lift: sim.lift,
    isQuiet: sim.life.isQuiet,
    isNight: isNightSun(sim.light.sun),
    flowSeconds: reducedMotion.value ? 0 : flowStep / MS_PER_SECOND,
    ...(banner === undefined ? {} : { banner }),
  }
}

/** Everything the data faces read, by reference: while none moved, no face needs asking again. */
export function infoInputsOf(scale: number, mood: FaceMood): readonly unknown[] {
  return [
    ...signInputsOf(mood),
    mood.isQuiet,
    mood.isNight,
    mood.flowSeconds,
    mood.banner,
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
export function infoJobOf(
  face: InfoFace,
  at: { readonly scale: number; readonly mood: FaceMood }
): InfoJob {
  const { scale, mood } = at

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
    case 'lift':
    case 'vending':
    case 'plaque':
    case 'copier':
      return signJobOf({ ...face, kind: face.kind }, mood)
    default: {
      const view = standByOf({ ...face, kind: face.kind }, mood)

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

function standByOf(face: InfoFace & { readonly kind: StandByKind }, mood: FaceMood): StandByView {
  const { minute, day } = pageMinute.value
  const index = homeIndex.value
  const view = STANDBY_VIEWS[face.kind]
  const banner = BANNER_ROOMS.has(face.room) ? mood.banner : undefined

  return {
    view,
    time: formatHourOfDay(minute / MINUTES_PER_HOUR),
    date: formatDay(locale.value, day),
    minute,
    isNight: mood.isNight,
    isDim: mood.isQuiet,
    flowSeconds: view === 'flow' ? mood.flowSeconds : 0,
    ...(banner === undefined ? {} : { banner }),
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
