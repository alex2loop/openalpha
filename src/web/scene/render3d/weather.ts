import {
  type BufferGeometry,
  CanvasTexture,
  type Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

import type { Materials } from '@/web/scene/render3d/lights'
import type { FloorId, SimView } from '@/web/scene/types'
import { windowLightOf } from '@/web/scene/clock/window-light'
import { box, mergeBoxes } from '@/web/scene/render3d/boxes'
import { toUnits, WALL_PX } from '@/web/scene/render3d/space'
import {
  createSunPatches,
  disposeSunPatches,
  type SunPatches,
  syncSunPatches,
} from '@/web/scene/render3d/sun-patches'
import { PROP_TONES, UMBRELLA_TONES } from '@/web/scene/sprites/palette'
import {
  blindSpansOf,
  flashOf,
  isGlassMoving,
  isHazeOn,
  paintGlassHaze,
  paintGlassRain,
  STREAK_FRAME_MS,
} from '@/web/scene/sprites/sky-glass'
import { WORLD } from '@/web/scene/types'
import { visibleRect } from '@/web/scene/view'
import { EXIT_MAT, propsOn } from '@/web/scene/world/props'
import { WALL_BAND_PX } from '@/web/scene/world/rooms'

// The rain pane stands just inside the north curtain glass, over its height, at this many canvas
// px per world px.
const PANE = Object.freeze({ z: WALL_BAND_PX - 1.6, inset: 1.5, px: 2 })
// The west blinds hang from under the ceiling frame just inside the glass, as deep as they are drawn.
const BLIND = Object.freeze({
  x: 0.3,
  w: 1.2,
  top: WALL_PX - 1.5,
  drop: WALL_PX - 3,
  tone: '#EDE3CC',
})
const MAT_TONE = '#3E4250'
const STAND_FLOOR: FloorId = 'office'
const BLIND_FLOORS: readonly FloorId[] = ['office', 'team']

/** What a sync changed this frame; one object, filled in place. */
interface WeatherSync {
  isChanged: boolean
  isAnimating: boolean
}

/** The weather indoors in 3D: rain and haze on the north glass, the west and east blinds, the
 *  sun's patches on the floor, and the
 *  umbrella stand and mat by the street exit with an umbrella opened to dry in the rain. */
export interface Weather3d {
  readonly pane: Mesh<PlaneGeometry, MeshBasicMaterial>
  readonly canvas: HTMLCanvasElement
  readonly texture: CanvasTexture
  readonly blinds: Readonly<Record<FloorId, Mesh>>
  readonly stand: Mesh
  readonly open: Mesh
  readonly geometries: readonly BufferGeometry[]
  /** The sun's patches on the floor and the east blinds. */
  readonly sun: SunPatches
  paintedAt: number
  /** The rain and haze the pane was last painted with; a negative rain for none. */
  paintedRain: number
  paintedHaze: boolean
  closure: number
  readonly sync: WeatherSync
}

export function createWeather3d(root: Group, materials: Materials): Weather3d {
  const { pane, canvas, texture } = createPane()
  const geometries = [
    mergeBoxes(blindBoxesOf('office')),
    mergeBoxes(blindBoxesOf('team')),
    mergeBoxes(standBoxes()),
    mergeBoxes(openUmbrellaBoxes()),
  ]
  const [officeBlinds, teamBlinds, standGeometry, openGeometry] = geometries
  const blinds = {
    office: new Mesh(officeBlinds, materials.lit),
    team: new Mesh(teamBlinds, materials.lit),
  }
  const stand = new Mesh(standGeometry, materials.lit)
  const open = new Mesh(openGeometry, materials.lit)

  for (const mesh of [blinds.office, blinds.team, open]) {
    mesh.visible = false
  }

  blinds.office.position.y = toUnits(BLIND.top)
  blinds.team.position.y = toUnits(BLIND.top)
  root.add(pane, blinds.office, blinds.team, stand, open)

  return {
    pane,
    canvas,
    texture,
    blinds,
    stand,
    open,
    geometries,
    sun: createSunPatches(root, materials),
    paintedAt: Number.NEGATIVE_INFINITY,
    paintedRain: -1,
    paintedHaze: false,
    closure: -1,
    sync: { isChanged: false, isAnimating: false },
  }
}

// The pane over the north glass, its canvas and texture, hidden until it rains or fogs.
function createPane(): Pick<Weather3d, 'pane' | 'canvas' | 'texture'> {
  const canvas = document.createElement('canvas')
  const paneH = WALL_PX - PANE.inset * 2

  canvas.width = WORLD.w * PANE.px
  canvas.height = paneH * PANE.px

  const texture = new CanvasTexture(canvas)

  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter

  const pane = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
  )

  pane.scale.set(toUnits(WORLD.w), toUnits(paneH), 1)
  pane.position.set(toUnits(WORLD.w / 2), toUnits(WALL_PX / 2), toUnits(PANE.z))
  pane.renderOrder = 2
  pane.visible = false

  return { pane, canvas, texture }
}

/** Places the weather for this frame; `isChanged` when something drawn moved, `isAnimating`
 *  while rain runs down the glass or a flash fades. */
export function syncWeather3d(weather3d: Weather3d, sim: SimView, now: number): WeatherSync {
  const fx = sim.weather
  const isPaneChanged = syncPane(weather3d, sim, now)
  const closure = windowLightOf(sim.light.sun, { cloud: sim.light.cloud, rain: fx.rain }).blind.w
  const isBlindChanged = closure !== weather3d.closure
  const isStandFloor = sim.floor === STAND_FLOOR
  const isOpen = isStandFloor && fx.rain > 0
  const isStandChanged =
    weather3d.stand.visible !== isStandFloor || weather3d.open.visible !== isOpen

  weather3d.closure = closure
  weather3d.stand.visible = isStandFloor
  weather3d.open.visible = isOpen

  for (const floor of BLIND_FLOORS) {
    const mesh = weather3d.blinds[floor]

    mesh.visible = floor === sim.floor && closure > 0
    mesh.scale.y = Math.max(closure, Number.EPSILON) * BLIND.drop
  }

  const isSunMoved = syncSunPatches(weather3d.sun, sim)

  weather3d.sync.isChanged =
    isPaneChanged || isBlindChanged || isStandChanged || isSunMoved || flashOf(fx, now) > 0
  weather3d.sync.isAnimating = isGlassMoving(fx, now, visibleRect())

  return weather3d.sync
}

export function disposeWeather3d(weather3d: Weather3d): void {
  weather3d.pane.removeFromParent()
  weather3d.pane.geometry.dispose()
  weather3d.pane.material.dispose()
  weather3d.texture.dispose()
  disposeSunPatches(weather3d.sun)

  for (const mesh of [
    weather3d.blinds.office,
    weather3d.blinds.team,
    weather3d.stand,
    weather3d.open,
  ]) {
    mesh.removeFromParent()
  }

  for (const geometry of weather3d.geometries) {
    geometry.dispose()
  }

  weather3d.canvas.width = 0
  weather3d.canvas.height = 0
}

// Repainted when the rain or haze changes, and while rain falls at most every `STREAK_FRAME_MS`.
function syncPane(weather3d: Weather3d, sim: SimView, now: number): boolean {
  const fx = sim.weather
  const isHaze = isHazeOn(sim.light, fx)
  const isShown = fx.rain > 0 || isHaze
  const isDue = fx.falling > 0 && now - weather3d.paintedAt >= STREAK_FRAME_MS

  if (!isShown) {
    const wasShown = weather3d.pane.visible

    weather3d.pane.visible = false
    weather3d.paintedRain = -1

    return wasShown
  }

  if (fx.rain === weather3d.paintedRain && isHaze === weather3d.paintedHaze && !isDue) {
    return false
  }

  const g = weather3d.canvas.getContext('2d')

  if (g === null) {
    return false
  }

  const pane = { x: 0, y: 0, w: WORLD.w, h: WALL_PX - PANE.inset * 2 }

  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, weather3d.canvas.width, weather3d.canvas.height)
  g.setTransform(PANE.px, 0, 0, PANE.px, 0, 0)

  if (fx.rain > 0) {
    paintGlassRain(g, pane, { rain: fx.rain, t: fx.falling > 0 ? now : 0 })
  }

  if (isHaze) {
    paintGlassHaze(g, pane)
  }

  weather3d.texture.needsUpdate = true
  weather3d.pane.visible = true
  weather3d.paintedRain = fx.rain
  weather3d.paintedHaze = isHaze
  weather3d.paintedAt = now

  return true
}

// One slab each side of the west doorway, 1 px tall from 0 down: the mesh's y scale drops it.
function blindBoxesOf(floor: FloorId) {
  return blindSpansOf(floor).map(([from, to]) =>
    box([BLIND.x, from, BLIND.w, to - from, -1, 1], BLIND.tone)
  )
}

// The stand with two closed umbrellas, and the dark mat inside the exit.
function standBoxes() {
  const prop = propsOn(STAND_FLOOR).find((each) => each.kind === 'umbrella-stand')
  const mat = box([EXIT_MAT.x, EXIT_MAT.y, EXIT_MAT.w, EXIT_MAT.h, 0, 0.3], MAT_TONE)

  if (prop === undefined) {
    return [mat]
  }

  const { x, y, w, h } = prop.rect

  return [
    mat,
    box([x, y, w, h, 0, 6], PROP_TONES.umbrellaStand, true),
    box([x + 1, y + 1.5, 1.2, 1.2, 4, prop.height + 4], UMBRELLA_TONES[0]),
    box([x + 3.5, y + 2, 1.2, 1.2, 4, prop.height + 3], UMBRELLA_TONES[1]),
  ]
}

// An umbrella opened on the mat to dry: its canopy and handle.
function openUmbrellaBoxes() {
  const cx = EXIT_MAT.x + EXIT_MAT.w / 2
  const cz = EXIT_MAT.y + EXIT_MAT.h / 2

  return [
    box([cx - 6, cz - 6, 12, 12, 2, 3.5], UMBRELLA_TONES[0], true),
    box([cx - 0.4, cz - 0.4, 0.8, 0.8, 0.3, 3], '#2E3440'),
  ]
}
