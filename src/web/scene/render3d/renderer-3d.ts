import { Group, OrthographicCamera, Scene, Sprite, Vector2, WebGLRenderer } from 'three'

import type { RendererStats, SceneRenderer } from '@/web/scene/renderer'
import type { SimView, Size } from '@/web/scene/types'
import { indexDrop } from '@/web/scene/data/board'
import { syncSeeThrough } from '@/web/scene/render3d/building'
import {
  type CameraRig,
  type Placement,
  placeCamera,
  toScreen,
  toWorld,
} from '@/web/scene/render3d/camera'
import {
  type Cast,
  createCast,
  disposeCast,
  type Standing,
  syncCast,
} from '@/web/scene/render3d/characters'
import {
  createEffects,
  disposeEffects,
  type Effects,
  syncEffects,
} from '@/web/scene/render3d/effects'
import {
  createFixtures,
  disposeFixtures,
  type Fixtures,
  syncFixtures,
} from '@/web/scene/render3d/fixtures'
import { buildFloor, disposeFloor, type FloorScene } from '@/web/scene/render3d/floor'
import { createShapes, type Shapes } from '@/web/scene/render3d/instancing'
import { createLamps, disposeLamps, type Lamps, syncLamps } from '@/web/scene/render3d/lamps'
import { createLighting, type Lighting, syncLighting } from '@/web/scene/render3d/lights'
import { createPets, disposePets, type Pets, syncPets } from '@/web/scene/render3d/pets'
import {
  createScreenFaces,
  disposeScreenFaces,
  type ScreenFaces,
  syncScreenFaces,
} from '@/web/scene/render3d/screen-faces'
  createStreetPlanes,
  disposeStreetPlanes,
  type StreetPlanes,
  syncStreetPlanes,
} from '@/web/scene/render3d/street-planes'
import {
  createTeamPieces,
  disposeTeamPieces,
  syncTeamPieces,
  type TeamPieces,
} from '@/web/scene/render3d/team'
import { createRenderRate, zeroCanvas } from '@/web/scene/renderer'
import { isActorWalking, isCharacterMotionOn } from '@/web/scene/sim/actors/poses'
import { detailOf } from '@/web/scene/sim/life/animal-model'
import { DAY_LIGHT_HOUR, type LightRow, lightAt } from '@/web/scene/sprites/daylight'
import { selectedActor } from '@/web/state/focus'
import { colorScheme, reducedMotion } from '@/web/state/prefs'

const CANVAS_CLASS = 'scene-canvas'
const STAGE_TOKEN = '--stage'
const STAGE_FALLBACK = 0xffffff
const MAX_PIXEL_RATIO = 2
const CAMERA_NEAR = 1
const CAMERA_FAR = 400
const MAX_FRAME_DT_MS = 100
const paneSize = new Vector2()
const IDENTITY: Placement = Object.freeze({ scale: 1, originX: 0, originY: 0 })

// One mounted WebGL canvas and everything it owns.
interface Stage extends CameraRig {
  readonly canvas: HTMLCanvasElement
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly lighting: Lighting
  readonly shapes: Shapes
  readonly fixtures: Fixtures
  readonly effects: Effects
  readonly team: TeamPieces
  readonly cast: Cast
  readonly pets: Pets
  readonly lamps: Lamps
  readonly faces: ScreenFaces
  readonly street: StreetPlanes
  floor: FloorScene | undefined
  scheme: string
  lastAt: number | undefined
  drawCalls: number
}

/** The 3D renderer: a fixed oblique orthographic camera framing the same floor as 2D, the
 *  building and furniture merged per room, the people as toon figures with outlines, and a
 *  render only when the picture changed. */
export function createRenderer3d(): SceneRenderer {
  let stage: Stage | undefined
  let frameMs = 0
  const renderRate = createRenderRate()

  return {
    mount(host) {
      stage ??= createStage(host)
    },
    unmount() {
      releaseStage(stage)
      stage = undefined
    },
    draw(sim, now) {
      if (stage === undefined) {
        return false
      }

      const startedAt = performance.now()
      const frame = drawFrame(stage, sim, now)

      if (frame.isRendered) {
        frameMs = performance.now() - startedAt
        renderRate.note(now)
      }

      return frame.isAnimating
    },
    toScreen: (p) => toScreen(stage?.placement ?? IDENTITY, p),
    toWorld: (s) => toWorld(stage?.placement ?? IDENTITY, s),
    stats: (): RendererStats => ({
      view: '3d',
      frameMs,
      rendersPerSecond: renderRate.perSecond(performance.now()),
      drawCalls: stage?.drawCalls ?? 0,
    }),
  }
}

// The WebGL renderer is made on a canvas not yet in the page: without WebGL its constructor
// throws, and nothing is left behind for the composer's fallback to clean up. A throw after it
// releases the context before it goes on; the canvas joins the page only once all is built.
function createStage(host: HTMLElement): Stage {
  const canvas = document.createElement('canvas')
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' })

  try {
    const stage = buildStage(canvas, renderer)

    canvas.className = CANVAS_CLASS
    canvas.tabIndex = 0
    host.append(canvas)

    return stage
  } catch (error) {
    renderer.dispose()
    renderer.forceContextLoss()

    throw error
  }
}

function buildStage(canvas: HTMLCanvasElement, renderer: WebGLRenderer): Stage {
  const scene = new Scene()
  const root = new Group()
  const lighting = createLighting(scene)
  const shapes = createShapes()
  const cast = createCast(lighting.materials.toon)
  const pets = createPets()

  scene.add(root, cast.root, pets.root)
  // The street canvas carries the sky.
  lighting.sky.visible = false

  return {
    canvas,
    renderer,
    scene,
    camera: new OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR),
    lighting,
    shapes,
    fixtures: createFixtures(shapes, lighting.materials, root),
    effects: createEffects(shapes, lighting.materials, root),
    team: createTeamPieces(shapes, lighting.materials, root),
    cast,
    pets,
    lamps: createLamps(scene),
    faces: createScreenFaces(root, lighting),
    street: createStreetPlanes(scene),
    floor: undefined,
    shot: undefined,
    placement: { scale: 1, originX: 0, originY: 0 },
    scheme: '',
    lastAt: undefined,
    drawCalls: 0,
  }
}

// Every geometry, material, texture and the context go; three's shared sprite geometry would
// otherwise keep the old context alive.
function releaseStage(stage: Stage | undefined): void {
  if (stage === undefined) {
    return
  }

  if (stage.floor !== undefined) {
    disposeFloor(stage.floor, stage.lighting.materials)
  }

  disposeFixtures(stage.fixtures)
  disposeEffects(stage.effects)
  disposeTeamPieces(stage.team)
  disposeCast(stage.cast)
  disposePets(stage.pets)
  disposeLamps(stage.lamps)
  disposeScreenFaces(stage.faces)
  disposeStreetPlanes(stage.street)

  for (const one of [...stage.lighting.disposables, ...stage.shapes.disposables]) {
    one.dispose()
  }

  stage.scene.clear()
  stage.renderer.dispose()
  stage.renderer.forceContextLoss()
  // Every sprite shares one geometry: disposing a throwaway's frees the shared one.
  new Sprite().geometry.dispose()
  zeroCanvas(stage.canvas)
  stage.canvas.remove()
}

interface DrawnFrame {
  readonly isRendered: boolean
  readonly isAnimating: boolean
}

function drawFrame(stage: Stage, sim: SimView, now: number): DrawnFrame {
  const pane = { w: stage.canvas.clientWidth, h: stage.canvas.clientHeight }

  if (pane.w === 0 || pane.h === 0) {
    return { isRendered: false, isAnimating: false }
  }

  const dtMs = Math.min(MAX_FRAME_DT_MS, now - (stage.lastAt ?? now))
  const isReduced = reducedMotion.value
  const isResized = resize(stage, pane)
  const camera = placeCamera(stage, { pane, dtMs, isReduced })
  const isNewFloor = syncFloor(stage, sim)
  const scene = syncScene(stage, { sim, now, dtMs, isReduced })
  const street = syncStreetPlanes(stage.street, { frame: sim.street, now })

  stage.lastAt = now

  const isChanged =
    isResized ||
    camera.isMoved ||
    isNewFloor ||
    scene.isChanged ||
    street.isChanged ||
    syncStageColor(stage)

  if (isChanged) {
    stage.renderer.render(stage.scene, stage.camera)
    stage.drawCalls = stage.renderer.info.render.calls
  }

  return {
    isRendered: isChanged,
    isAnimating: camera.isGliding || scene.isAnimating || street.isPending,
  }
}

interface SceneJob {
  readonly sim: SimView
  readonly now: number
  readonly dtMs: number
  readonly isReduced: boolean
}

// Moves everything that changes with the snapshot; `isAnimating` while small motion still runs.
function syncScene(
  stage: Stage,
  job: SceneJob
): { readonly isChanged: boolean; readonly isAnimating: boolean } {
  const { sim, now, dtMs, isReduced } = job
  const row = lightAt(sim.light.followsHour ? sim.light.hour : DAY_LIGHT_HOUR)
  const isMotionOn = isCharacterMotionOn(sim.actors, { floor: sim.floor, now })
  const { lit, lampGlow, isClosed } = sim.props
  const isLightEasing = syncLighting(stage.lighting, {
    floor: sim.floor,
    lit,
    lampGlow,
    isClosed,
    row,
    dtMs,
    isReduced,
  })
  const people = syncCast(stage.cast, {
    actors: sim.actors,
    floor: sim.floor,
    alpha: sim.alpha,
    now,
    dtMs,
    scale: stage.placement.scale,
    isMotionOn,
    isReduced,
  })
  const isWallFading =
    stage.floor !== undefined &&
    syncSeeThrough(stage.floor.walls, { people: people.standing, dtMs, isReduced })
  const dressing = syncDressing(stage, { job, row, standing: people.standing })
  const isSmall = !isReduced && (isMotionOn || sim.life.animatedFloors.includes(sim.floor))
  const isMoving = isLightEasing || people.isSettling || dressing.isMoving || isWallFading
  const isWalking = people.standing.some(({ actor }) => isActorWalking(actor))

  return {
    isChanged: isMoving || isSmall || dressing.isChanged || isWalking,
    isAnimating: isMoving || isSmall,
  }
}

// The fixtures, the office life's effects, the faces and lamps, and the pets, around the people
// just placed.
function syncDressing(
  stage: Stage,
  at: { readonly job: SceneJob; readonly row: LightRow; readonly standing: readonly Standing[] }
): { readonly isChanged: boolean; readonly isMoving: boolean } {
  const { sim, now, isReduced } = at.job
  const { scale } = stage.placement
  const level = detailOf(scale)
  const props = stage.floor?.props
  const isFixed =
    props !== undefined &&
    syncFixtures(stage.fixtures, {
      sim,
      props,
      standing: at.standing,
      row: at.row,
      selected: selectedActor.value,
      dropPct: indexDrop.value?.movePct,
      scale,
    })
  const effectFrame = { sim, now, level, isReduced }
  const effects = syncEffects(stage.effects, effectFrame)
  const team = syncTeamPieces(stage.team, effectFrame)
  const isShown = syncFacesAndLamps(stage, sim)

  const isPetMoved = syncPets(stage.pets, sim.life, {
    floor: sim.floor,
    alpha: sim.alpha,
    level,
    material: stage.lighting.materials.lit,
  })

  return {
    isChanged: isFixed || effects.isChanged || team.isChanged || isPetMoved || isShown,
    isMoving: effects.isMoving || team.isMoving,
  }
}

// The screen faces and cork boards, and the lamps' lights nearest the camera's centre.
function syncFacesAndLamps(stage: Stage, sim: SimView): boolean {
  const isFaceChanged = syncScreenFaces(stage.faces, {
    floor: sim.floor,
    scale: stage.placement.scale,
    walls: stage.floor?.walls ?? [],
  })
  const isLampChanged = syncLamps(stage.lamps, {
    lamps: stage.floor?.props.lamps ?? [],
    lit: sim.props.lit,
    lampGlow: sim.props.lampGlow,
    focus: stage.shot?.center,
  })

  return isFaceChanged || isLampChanged
}

function syncFloor(stage: Stage, sim: SimView): boolean {
  if (stage.floor?.id === sim.floor) {
    return false
  }

  if (stage.floor !== undefined) {
    disposeFloor(stage.floor, stage.lighting.materials)
  }

  stage.floor = buildFloor(sim.floor, stage.lighting)
  stage.scene.add(stage.floor.group)

  return true
}

// The pane's stage colour behind the building, read once per scheme.
function syncStageColor(stage: Stage): boolean {
  const scheme = colorScheme.value

  if (stage.scheme === scheme) {
    return false
  }

  const stageColor = getComputedStyle(stage.canvas).getPropertyValue(STAGE_TOKEN).trim()

  stage.scheme = scheme
  stage.renderer.setClearColor(stageColor === '' ? STAGE_FALLBACK : stageColor)

  return true
}

function resize(stage: Stage, pane: Size): boolean {
  const ratio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO)
  const held = stage.renderer.getSize(paneSize)

  if (stage.renderer.getPixelRatio() === ratio && held.x === pane.w && held.y === pane.h) {
    return false
  }

  stage.renderer.setPixelRatio(ratio)
  stage.renderer.setSize(pane.w, pane.h, false)

  return true
}
