import {
  CanvasTexture,
  type Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

import type { DeskScreenView } from '@/web/scene/overlay-types'
import type { Screen } from '@/web/scene/render3d/desk-dressing'
import type { Pool } from '@/web/scene/render3d/instancing'
import type { FloorProps } from '@/web/scene/render3d/props'
import type { FloorId, Point, RoomId } from '@/web/scene/types'
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
import { flatPoseOf } from '@/web/scene/render3d/seated'
import { toUnits } from '@/web/scene/render3d/space'
import { zeroCanvas } from '@/web/scene/renderer'
import { roomAt } from '@/web/scene/world/rooms'
import { findRun } from '@/web/state/live'
import { formatHourOfDay } from '@/web/text/time'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'

const FACE_LIFT_PX = 0.06
// A lit desk screen's bottom stands within this of its computer's foot.
const SLOT_MATCH_PX = 6
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
  /** The computer's foot, where a lit desk screen names the monitor it shows on. */
  readonly slot: Point
  readonly screen: Screen
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>
  /** Whether the face lies flat before a sitter, as last placed. */
  isFlat: boolean
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
    /** The screens laid flat before someone sitting at them. */
    readonly seated: readonly boolean[]
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

    isChanged = placeFace(face, at.seated[i] === true) || isChanged

    const host = isLit ? hostOn(face, at.deskScreens) : undefined

    const isTiny = isMonitorTiny(face.screen.size[0], at.scale)

    isChanged =
      (isLit && paintFace(face, { ...at, host, isTiny, runId: at.runIds[i] })) || isChanged
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
    slot: screen.slot,
    screen,
    mesh,
    isFlat: true,
    canvas,
    texture,
    typing: { key: '', startMs: 0 },
    key: '',
    cursor: undefined,
  }

  placeFace(face, false)

  return face
}

// The face stands on its leaning screen, or lies on the glass laid flat before a sitter; true
// when it moved.
function placeFace(face: MonitorFace, isFlat: boolean): boolean {
  if (face.isFlat === isFlat) {
    return false
  }

  const { screen, mesh } = face
  const lift = screen.size[2] / 2 + FACE_LIFT_PX

  face.isFlat = isFlat

  if (isFlat) {
    const [x, y, z] = flatPoseOf(screen, screen.deskTop).face

    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(toUnits(x), toUnits(y + lift), toUnits(z))
    return true
  }

  const [x, y, z] = screen.at

  mesh.rotation.x = screen.tilt
  mesh.position.set(
    toUnits(x),
    toUnits(y - Math.sin(screen.tilt) * lift),
    toUnits(z + Math.cos(screen.tilt) * lift)
  )

  return true
}

// The worker's run on the screen, as a terminal: a new line starts typing again, a beat at a
// time; the face is drawn again only when what it shows moved.
function paintFace(
  face: MonitorFace,
  at: {
    readonly now: number
    readonly isReduced: boolean
    readonly host: string | undefined
    readonly isTiny: boolean
    readonly runId: string | undefined
  }
): boolean {
  const run = at.runId === undefined ? undefined : findRun(at.runId)
  const lines = run === undefined ? [] : terminalLinesOf(run, at.host)
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
    title: at.host ?? run?.title ?? run?.name ?? '',
    isTiny: at.isTiny,
  })
  face.texture.needsUpdate = true

  return true
}

// The page a scout reads on this monitor, the host in its title bar as the overlay showed it.
function hostOn(face: MonitorFace, screens: readonly DeskScreenView[]): string | undefined {
  const shown = screens.find(
    ({ rect }) =>
      Math.abs(rect.x + rect.w / 2 - face.slot.x) <= SLOT_MATCH_PX &&
      Math.abs(rect.y + rect.h - face.slot.y) <= SLOT_MATCH_PX
  )

  return shown?.content.kind === 'host' ? shown.content.host : undefined
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
