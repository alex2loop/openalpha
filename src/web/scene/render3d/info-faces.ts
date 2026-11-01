import type { DeskFace } from '@/web/scene/render3d/desk-dressing'
import type { FloorProps } from '@/web/scene/render3d/props'
import type { FloorId, RoomId, SimView } from '@/web/scene/types'
import { formatDay } from '@/i18n'
import { pageMinute } from '@/web/scene/clock/clock'
import { isNightSun } from '@/web/scene/clock/sun'
import { regionPack, wallClockMinutes } from '@/web/scene/data/home'
import { homeIndex } from '@/web/scene/data/led'
import {
  paintBoard,
  paintCalendar,
  paintClock,
  paintStandBy,
  type StandByView,
  type TapeRow,
} from '@/web/scene/render3d/face-paint'
import {
  type SignFace,
  type SignFrame,
  signFacesOf,
  signInputsOf,
  signJobOf,
} from '@/web/scene/render3d/sign-faces'
import { wallSpotsOf } from '@/web/scene/render3d/wall-spots'
import { boardCaptions } from '@/web/scene/sim/board-captions'
import { faceKindOf } from '@/web/scene/sprites/screens'
import { type PropDef, propsOn } from '@/web/scene/world/props'
import { notices } from '@/web/state/notices'
import { reducedMotion } from '@/web/state/prefs'
import { locale } from '@/web/state/session'
import { formatFixed, formatSignedPercent, toneOfPercent } from '@/web/text/figures'
import { toNoticeText } from '@/web/text/notice'
import { formatHourOfDay } from '@/web/text/time'
import { MINUTES_PER_HOUR, MS_PER_SECOND } from '@/web/text/time-units'

const INDEX_DIGITS = 2
const DAY_DIGITS_FROM = 8
// The lobby's clocks keep the region's zones; their face is this much taller for the label.
const ZONED_ROOM: RoomId = 'lobby'
const LABELLED_CLOCK_SHARE = 1.25
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
  readonly kind: 'board' | 'clock' | DeskFace['kind'] | SignFace['kind']
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
export function infoInputsOf(mood: FaceMood): readonly unknown[] {
  return [
    ...signInputsOf(mood),
    mood.isQuiet,
    mood.isNight,
    mood.flowSeconds,
    mood.banner,
    pageMinute.value,
    boardCaptions.value,
    wallClockMinutes.value,
    homeIndex.value,
    locale.value,
  ]
}

/** What `face` shows this frame; `isTiny` is whether the zoom leaves a board too small for its
 *  title. */
export function infoJobOf(
  face: InfoFace,
  at: { readonly mood: FaceMood; readonly isTiny: boolean }
): InfoJob {
  const { mood, isTiny } = at

  switch (face.kind) {
    case 'board': {
      const caption = boardCaptions.value[face.room]

      return {
        key: `${caption ?? ''}|${isTiny}`,
        paint: (c) => paintBoard(c, { caption, isTiny, seed: face.seed }),
      }
    }
    case 'clock': {
      const clock = clockOf(face)

      return { key: JSON.stringify(clock), paint: (c) => paintClock(c, clock) }
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

function wallKindOf(prop: PropDef): 'board' | 'clock' | undefined {
  if (faceKindOf(prop) !== undefined) {
    return undefined
  }

  if (prop.kind === 'whiteboard') {
    return 'board'
  }

  return prop.kind === 'clock' ? 'clock' : undefined
}

function wallFace(prop: PropDef, kind: 'board' | 'clock'): InfoFace {
  const spots = wallSpotsOf(prop)
  const [x, z, w, d, y, h] = spots.face
  // A lobby clock carries its zone's label in a strip under the dial, as the mockup's.
  const tall = kind === 'clock' && prop.room === ZONED_ROOM ? h * LABELLED_CLOCK_SHARE : h

  return {
    kind,
    room: prop.room,
    at: [x + w / 2, y + h - tall / 2, z + d + FACE_LIFT_PX],
    size: [w, tall],
    tilt: 0,
    isGlowing: false,
    ...(spots.wallZ === undefined ? {} : { wallAt: { x: prop.rect.x, wallZ: spots.wallZ } }),
    seed: prop.variant ?? 0,
  }
}

// A lobby clock reads its region's zone and carries its label; any other reads the page clock.
function clockOf(face: InfoFace): { readonly minute: number; readonly label?: string } {
  const zoned = face.room === ZONED_ROOM ? regionPack.value.wallClocks[face.seed] : undefined
  const minute = zoned === undefined ? undefined : wallClockMinutes.value[face.seed]

  if (zoned === undefined || minute === undefined) {
    return { minute: pageMinute.value.minute }
  }

  return { minute, label: zoned.label }
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
