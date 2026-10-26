import {
  CanvasTexture,
  type Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

import type { MessageKey } from '@/i18n'
import type { DeskScreenView } from '@/web/scene/overlay-types'
import type { Screen } from '@/web/scene/render3d/desk-dressing'
import type { FloorProps } from '@/web/scene/render3d/props'
import type { FloorId, Point, RoomId } from '@/web/scene/types'
import type { Run } from '@/web/state/live'
import { pageMinute } from '@/web/scene/clock/clock'
import { roomStatus } from '@/web/scene/data/room-status'
import { flatPoseOf } from '@/web/scene/render3d/seated'
import { toUnits } from '@/web/scene/render3d/space'
import { zeroCanvas } from '@/web/scene/renderer'
import { FONT } from '@/web/scene/sprites/face-text'
import { roomAt } from '@/web/scene/world/rooms'
import { formatHourOfDay } from '@/web/text/time'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'

// The mockup's monitor screen: a 160 by 100 logical window drawn at twice that, with a menu bar,
// a title bar with three dots, typed lines and a status bar.
const SCREEN = Object.freeze({ w: 160, h: 100, res: 2, bar: 4, menu: 10, title: 12, status: 10 })
const LINE = Object.freeze({ px: 7.5, lead: 11, rows: 4, pad: 4 })
const TONE = Object.freeze({
  rim: '#262B3D',
  edge: '#3A4260',
  body: '#141A36',
  menu: '#0B0F22',
  title: '#2B3566',
  menuInk: '#E9ECF8',
  clock: '#C9D3F0',
  titleInk: '#B9C4EE',
  text: '#DCE3FA',
  status: '#8FA0C8',
  cursor: '#6FE3D6',
})
const DOTS = ['#FF6259', '#F2C46C', '#6FE3D6'] as const
// The mockup types a few characters per tick; a new step types afresh.
const TYPE_TICK_MS = 65
const CHARS_PER_TICK = 2
const FACE_LIFT_PX = 0.06
// A lit desk screen's bottom stands within this of its computer's foot.
const SLOT_MATCH_PX = 6
const APP_KEYS: Readonly<Partial<Record<RoomId, MessageKey>>> = Object.freeze({
  lib: 'ui.office.room.lib',
  meet: 'ui.office.room.meet',
  assist: 'ui.office.room.assist',
  desk: 'ui.office.room.desk',
})

/** One canvas per monitor on the floor shown, drawn only while the monitor is lit by someone at
 *  work; it shows the room's run: its title, its lines and the step it is typing. */
export interface MonitorFaces {
  readonly root: Group
  readonly plane: PlaneGeometry
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
  target: string
  typed: number
  tickAt: number
  key: string
}

export function createMonitorFaces(root: Group): MonitorFaces {
  return { root, plane: new PlaneGeometry(1, 1), faces: [], floor: undefined }
}

/** Builds the floor's faces once, shows each lit one and types its step on; true when a face was
 *  drawn again or shown or hidden. */
export function syncMonitorFaces(
  monitors: MonitorFaces,
  at: {
    readonly floor: FloorId
    readonly props: FloorProps
    readonly lit: readonly boolean[]
    /** The screens laid flat before someone sitting at them. */
    readonly seated: readonly boolean[]
    /** The desk screens real work lights; each shows on the monitor at its computer. */
    readonly deskScreens: readonly DeskScreenView[]
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

    isChanged = (isLit && paintFace(face, { ...at, host })) || isChanged
  })

  return isChanged
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
    target: '',
    typed: 0,
    tickAt: 0,
    key: '',
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

// The room's run on the screen: a new step starts typing again; the face is drawn again only when
// what it shows moved.
function paintFace(
  face: MonitorFace,
  at: { readonly now: number; readonly isReduced: boolean; readonly host: string | undefined }
): boolean {
  const run = face.room === undefined ? undefined : roomStatus.value.get(face.room)?.runs[0]
  const target = run?.progress?.text ?? ''

  if (target !== face.target) {
    face.target = target
    face.typed = 0
    face.tickAt = at.now
  }

  const ticks = Math.floor((at.now - face.tickAt) / TYPE_TICK_MS)

  if (at.isReduced) {
    face.typed = target.length
  } else if (ticks > 0 && face.typed < target.length) {
    face.typed = Math.min(target.length, face.typed + ticks * CHARS_PER_TICK)
    face.tickAt += ticks * TYPE_TICK_MS
  }

  const clock = formatHourOfDay(pageMinute.value.minute / MINUTES_PER_HOUR)
  const key = [
    run?.runId,
    run?.title,
    run?.persistent.length,
    target,
    face.typed,
    clock,
    at.host,
  ].join('|')

  if (key === face.key) {
    return false
  }

  face.key = key
  drawScreen(face, { run, clock, title: at.host ?? run?.title ?? run?.name ?? '' })
  face.texture.needsUpdate = true

  return true
}

function drawScreen(
  face: MonitorFace,
  at: { readonly run: Run | undefined; readonly clock: string; readonly title: string }
): void {
  const c = face.canvas.getContext('2d')

  if (c === null) {
    return
  }

  const { w, h, bar, menu, title, status } = SCREEN
  const inner = w - bar * 2

  c.setTransform(SCREEN.res, 0, 0, SCREEN.res, 0, 0)
  c.fillStyle = TONE.rim
  c.fillRect(0, 0, w, h)
  c.fillStyle = TONE.edge
  c.fillRect(1.5, 1.5, w - 3, h - 3)
  c.fillStyle = TONE.body
  c.fillRect(bar, bar, inner, h - bar * 2)
  c.fillStyle = TONE.menu
  c.fillRect(bar, bar, inner, menu)
  c.fillRect(bar, h - bar - status, inner, status)
  c.fillStyle = TONE.title
  c.fillRect(bar, bar + menu, inner, title)
  drawChrome(c, { face, title: at.title, clock: at.clock })
  drawLines(c, face, at.run)
}

function drawChrome(
  c: CanvasRenderingContext2D,
  at: { readonly face: MonitorFace; readonly title: string; readonly clock: string }
): void {
  const { w, bar, menu, title } = SCREEN
  const menuY = bar + menu / 2 + 0.3
  const titleY = bar + menu + title / 2 + 0.3
  const appKey = at.face.room === undefined ? undefined : APP_KEYS[at.face.room]

  for (const [i, tone] of DOTS.entries()) {
    c.fillStyle = tone
    c.beginPath()
    c.arc(bar + 6 + i * 6, titleY, 1.7, 0, Math.PI * 2)
    c.fill()
  }

  c.textBaseline = 'middle'
  c.font = `700 7px ${FONT}`
  c.textAlign = 'left'
  c.fillStyle = TONE.menuInk
  c.fillText(appKey === undefined ? '' : tr(appKey), bar + 4, menuY, w * 0.6)
  c.textAlign = 'right'
  c.font = `600 7px ${FONT}`
  c.fillStyle = TONE.clock
  c.fillText(at.clock, w - bar - 4, menuY)
  c.textAlign = 'left'
  c.fillStyle = TONE.titleInk
  c.fillText(at.title, bar + 27, titleY, w - bar * 2 - 30)
}

// The run's last finished lines, then its step as typed so far with a cursor after it.
function drawLines(c: CanvasRenderingContext2D, face: MonitorFace, run: Run | undefined): void {
  const { w, h, bar, menu, title, status } = SCREEN
  const done = (run?.persistent ?? []).slice(-(LINE.rows - 1)).map((line) => line.text)
  const typing = face.target.slice(0, face.typed)
  const rows = [...done, typing]
  const top = bar + menu + title + 3 + LINE.lead / 2
  const maxW = w - (bar + LINE.pad) * 2

  c.font = `500 ${LINE.px}px ${FONT}`
  c.textAlign = 'left'

  for (const [i, text] of rows.entries()) {
    c.fillStyle = i === rows.length - 1 ? TONE.text : TONE.status
    c.fillText(text, bar + LINE.pad, top + i * LINE.lead, maxW)
  }

  const cursorX = Math.min(bar + LINE.pad + c.measureText(typing).width + 1, w - bar - LINE.pad)

  c.fillStyle = TONE.cursor
  c.fillRect(cursorX, top + (rows.length - 1) * LINE.lead - 3.5, 3, 7)
  c.font = `500 6.5px ${FONT}`
  c.fillStyle = TONE.status
  c.fillText(run?.name ?? '', bar + 4, h - bar - status / 2 + 0.3, w * 0.55)
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
