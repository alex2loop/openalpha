import {
  CanvasTexture,
  type Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

import type { DeskScreenContent, DeskScreenView } from '@/web/scene/overlay-types'
import type { Screen } from '@/web/scene/render3d/desk-dressing'
import type { Pool } from '@/web/scene/render3d/instancing'
import type { FloorProps } from '@/web/scene/render3d/props'
import type { FloorId, RoomId } from '@/web/scene/types'
import { ambientMsOf } from '@/web/scene/budgets'
import { pageMinute } from '@/web/scene/clock/clock'
import { charsTypedIn, terminalLinesOf } from '@/web/scene/data/screen-lines'
import { isCursorShown, syncCursors } from '@/web/scene/render3d/monitor-cursor'
import {
  type CursorRect,
  drawScreen,
  isMonitorTiny,
  SCREEN,
} from '@/web/scene/render3d/monitor-screen'
import { toUnits } from '@/web/scene/render3d/space'
import { zeroCanvas } from '@/web/scene/renderer'
import { roomAt } from '@/web/scene/world/rooms'
import { findRun } from '@/web/state/live'
import { formatHourOfDay } from '@/web/text/time'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'

const FACE_LIFT_PX = 0.06
// A lit desk screen's sitter sits within this of its monitor's seat.
const SEAT_MATCH_PX = 12
// A monitor's foot stands within this below its computer's drawn box.
const FOOT_REACH_PX = 20
/** One canvas per monitor on the floor shown, drawn only while the monitor is lit by someone at
 *  work; it shows that person's run: its title, its lines and the step it is typing. */
export interface MonitorFaces {
  readonly root: Group
  readonly plane: PlaneGeometry
  /** The cursors of the lit faces: one instanced mesh, blinking without a repaint. */
  readonly cursors: Pool
  faces: MonitorFace[]
  floor: FloorId | undefined
}

interface MonitorFace {
  readonly room: RoomId | undefined
  readonly screen: Screen
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>
  readonly canvas: HTMLCanvasElement
  readonly texture: CanvasTexture
  /** The line being typed and the ambient beat it began on; a new line types afresh. */
  typing: { key: string; startMs: number }
  key: string
  /** Where the cursor goes on the face, as last drawn. */
  cursor: CursorRect | undefined
}

export function createMonitorFaces(root: Group, cursors: Pool): MonitorFaces {
  return { root, plane: new PlaneGeometry(1, 1), cursors, faces: [], floor: undefined }
}

/** Builds the floor's faces once, shows each lit one and types its step on; true when a face was
 *  drawn again or shown or hidden. */
export function syncMonitorFaces(
  monitors: MonitorFaces,
  at: {
    readonly floor: FloorId
    readonly props: FloorProps
    readonly lit: readonly boolean[]
    /** The run each lit screen's worker is on. */
    readonly runIds: readonly (string | undefined)[]
    /** The desk screens real work lights; each shows on the monitor at its computer. */
    readonly deskScreens: readonly DeskScreenView[]
    /** CSS px per world px: a monitor too small on screen sets its lines as bars. */
    readonly scale: number
    readonly now: number
    readonly isReduced: boolean
  }
): boolean {
  if (monitors.floor !== at.floor) {
    releaseFaces(monitors)
    monitors.floor = at.floor
    monitors.faces = at.props.screens.map((screen) =>
      createFace(monitors, { screen, floor: at.floor })
    )
  }

  let isChanged = false

  monitors.faces.forEach((face, i) => {
    const isLit = at.lit[i] === true

    if (face.mesh.visible !== isLit) {
      face.mesh.visible = isLit
      isChanged = true
    }

    const shown = isLit ? shownOn(face.screen, at.deskScreens)?.content : undefined
    const host = shown?.kind === 'host' ? shown.host : undefined
    const tally = shown?.kind === 'tally' ? shown : undefined

    const isTiny = isMonitorTiny(face.screen.size[0], at.scale)

    isChanged =
      (isLit && paintFace(face, { ...at, host, tally, isTiny, runId: at.runIds[i] })) || isChanged
  })

  const isCursorChanged = syncCursors(monitors.cursors, {
    floor: at.floor,
    faces: monitors.faces,
    isShown: isCursorShown(at.now, at.isReduced),
  })

  return isCursorChanged || isChanged
}

export function disposeMonitorFaces(monitors: MonitorFaces): void {
  releaseFaces(monitors)
  monitors.plane.dispose()
}

function createFace(
  monitors: MonitorFaces,
  at: { readonly screen: Screen; readonly floor: FloorId }
): MonitorFace {
  const { screen } = at
  const canvas = document.createElement('canvas')
  const texture = new CanvasTexture(canvas)
  const mesh = new Mesh(monitors.plane, new MeshBasicMaterial({ map: texture, toneMapped: false }))
  const [w, h] = screen.size

  canvas.width = SCREEN.w * SCREEN.res
  canvas.height = SCREEN.h * SCREEN.res
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  mesh.scale.set(toUnits(w), toUnits(h), 1)
  mesh.visible = false
  monitors.root.add(mesh)

  const face: MonitorFace = {
    room: roomAt(at.floor, screen.seat)?.id,
    screen,
    mesh,
    canvas,
    texture,
    typing: { key: '', startMs: 0 },
    key: '',
    cursor: undefined,
  }

  placeFace(face)

  return face
}

// The face stands on its leaning screen, just proud of the glass.
function placeFace({ screen, mesh }: MonitorFace): void {
  const [x, y, z] = screen.at
  const lift = screen.size[2] / 2 + FACE_LIFT_PX

  mesh.rotation.x = screen.tilt
  mesh.position.set(
    toUnits(x),
    toUnits(y - Math.sin(screen.tilt) * lift),
    toUnits(z + Math.cos(screen.tilt) * lift)
  )
}

// The worker's run on the screen, as a terminal: a new line starts typing again, a beat at a
// time; the face is drawn again only when what it shows moved.
function paintFace(
  face: MonitorFace,
  at: {
    readonly now: number
    readonly isReduced: boolean
    readonly host: string | undefined
    /** An idle desk's count, shown in place of a run. */
    readonly tally: Extract<DeskScreenContent, { kind: 'tally' }> | undefined
    readonly isTiny: boolean
    readonly runId: string | undefined
  }
): boolean {
  const run = at.runId === undefined ? undefined : findRun(at.runId)
  const lines = at.tally?.lines ?? (run === undefined ? [] : terminalLinesOf(run, at.host))
  const last = lines.at(-1)
  const key = `${run?.runId}|${last?.id}`
  const beatMs = ambientMsOf(at.now)

  if (key !== face.typing.key) {
    face.typing = { key, startMs: beatMs }
  }

  const typed =
    last === undefined || at.isReduced
      ? (last?.text.length ?? 0)
      : charsTypedIn(last.text, beatMs - face.typing.startMs)
  const clock = formatHourOfDay(pageMinute.value.minute / MINUTES_PER_HOUR)
  const shown = [
    run?.runId,
    run?.title,
    clock,
    at.host,
    at.tally?.title,
    at.isTiny,
    typed,
    ...lines.map((line) => line.text),
  ].join('|')

  if (shown === face.key) {
    return false
  }

  face.key = shown
  face.cursor = drawScreen(face.canvas, {
    room: face.room,
    lines,
    typed,
    clock,
    name: run?.name,
    title: at.tally?.title ?? at.host ?? run?.title ?? run?.name ?? '',
    isTiny: at.isTiny,
  })
  face.texture.needsUpdate = true

  return true
}

/** The lit desk screen shown on this monitor: a scout's page, as the overlay showed it, whose
 *  sitter sits at its seat, or an idle desk's count, on the computer it stands over (the alert
 *  clerk sits behind the counter, not at the seat a desk's worker takes). */
export function shownOn(
  screen: Pick<Screen, 'seat' | 'slot'>,
  screens: readonly DeskScreenView[]
): DeskScreenView | undefined {
  const { seat, slot } = screen

  return screens.find((one) =>
    one.content.kind === 'tally'
      ? isOver(one.rect, slot)
      : Math.hypot(one.seat.x - seat.x, one.seat.y - seat.y) <= SEAT_MATCH_PX
  )
}

// The computer's box stands over the monitor's foot.
function isOver(rect: DeskScreenView['rect'], foot: Screen['slot']): boolean {
  return (
    foot.x >= rect.x &&
    foot.x <= rect.x + rect.w &&
    foot.y >= rect.y &&
    foot.y <= rect.y + rect.h + FOOT_REACH_PX
  )
}

function releaseFaces(monitors: MonitorFaces): void {
  for (const face of monitors.faces) {
    face.mesh.removeFromParent()
    face.mesh.material.dispose()
    face.texture.dispose()
    zeroCanvas(face.canvas)
  }

  monitors.faces = []
}
