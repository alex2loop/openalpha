import type { PaintScene } from '@/web/scene/render2d/wall-props'
import type { RendererStats, SceneRenderer } from '@/web/scene/renderer'
import type { LightRow } from '@/web/scene/sprites/daylight'
import { agenda } from '@/web/scene/data/agenda'
import { indexDrop } from '@/web/scene/data/board'
import { isPrintingRun, roomStatus } from '@/web/scene/data/room-status'
import { isBaked, paintBuilding } from '@/web/scene/render2d/building'
import { type Fit, fitFloor, fitRoom, toSnappedFit } from '@/web/scene/render2d/camera'
import { drawCharacter, releaseCharacterSprites } from '@/web/scene/render2d/characters'
import { buildLifePieces, paintLifeOver } from '@/web/scene/render2d/life-props'
import { paintLighting } from '@/web/scene/render2d/lights'
import { paintPapers, paintTray } from '@/web/scene/render2d/papers'
import { isBackProp, paintProp, tieRankOf } from '@/web/scene/render2d/props'
import {
  buildTeamPieces,
  isTeamMoving,
  paintTeamGlow,
  paintTeamTop,
} from '@/web/scene/render2d/team'
import { createRenderRate, zeroCanvas } from '@/web/scene/renderer'
import { isCharacterMotionOn } from '@/web/scene/sim/actors/poses'
import { detailOf } from '@/web/scene/sim/life/animal-model'
import { feedKOf } from '@/web/scene/sim/life/events'
import { DAY_LIGHT_HOUR, lightAt } from '@/web/scene/sprites/daylight'
import { boardNotes, createScreenCache, type ScreenCache } from '@/web/scene/sprites/screens'
import {
  type FloorId,
  type Point,
  type ScreenPoint,
  type SimView,
  type Size,
  WORLD,
} from '@/web/scene/types'
import { clampPan, FRAME_RECT, reportProjection, view, ZOOM_STEP } from '@/web/scene/view'
import { TEAM_FLOOR } from '@/web/scene/world/floors'
import { propsOn } from '@/web/scene/world/props'
import { roomById, WALL_BAND_PX } from '@/web/scene/world/rooms'
import { breakpoint } from '@/web/state/breakpoints'
import { selectedActor } from '@/web/state/focus'
import { unread } from '@/web/state/notices'
import { colorScheme, reducedMotion } from '@/web/state/prefs'
import { MINUTES_PER_HOUR } from '@/web/text/time'

const CANVAS_CLASS = 'scene-canvas'
const STAGE_TOKEN = '--stage'
const ACTOR_TIE_RANK = 2
// The operator's tray sits on your desk, on the office floor; the own agents work upstairs.
const TRAY_FLOOR: FloorId = 'office'
const IDENTITY_FIT: Placement = Object.freeze({ scale: 1, originX: 0, originY: 0 })

/** Where the floor sits in the pane: CSS px per world px and the CSS px of world (0, 0). */
interface Placement {
  readonly scale: number
  readonly originX: number
  readonly originY: number
}

interface Tokens {
  readonly scheme: string
  readonly stage: string
}

interface Background {
  readonly canvas: HTMLCanvasElement
  readonly floor: FloorId
}

// One mounted canvas, its offscreen floor and caches, and the placement of its last draw.
interface Surface {
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly offscreen: HTMLCanvasElement
  readonly screens: ScreenCache
  background: Background | undefined
  tokens: Tokens | undefined
  placement: Placement
}

interface Piece {
  readonly sortY: number
  readonly tie: number
  readonly draw: () => void
}

/** The 2D renderer: the cached floor, the props and people y-sorted on it, one light pass, all
 *  painted at a whole zoom offscreen and stretched to the camera's scale. */
export function createRenderer2d(): SceneRenderer {
  let surface: Surface | undefined
  let frameMs = 0
  const renderRate = createRenderRate()

  return {
    mount(host) {
      surface ??= createSurface(host)
    },
    unmount() {
      releaseSurface(surface)
      surface = undefined
    },
    draw(sim, now) {
      if (surface === undefined) {
        return false
      }

      const startedAt = performance.now()
      const isAnimating = paintFrame(surface, sim, now)

      frameMs = performance.now() - startedAt
      renderRate.note(now)

      return isAnimating
    },
    toScreen: (p) => toScreen(surface, p),
    toWorld: (s) => toWorld(surface, s),
    stats: (): RendererStats => ({
      view: '2d',
      frameMs,
      rendersPerSecond: renderRate.perSecond(performance.now()),
    }),
  }
}

function createSurface(host: HTMLElement): Surface | undefined {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (context === null) {
    return undefined
  }

  canvas.className = CANVAS_CLASS
  canvas.tabIndex = 0
  host.append(canvas)

  return {
    canvas,
    context,
    offscreen: document.createElement('canvas'),
    screens: createScreenCache(),
    background: undefined,
    tokens: undefined,
    placement: IDENTITY_FIT,
  }
}

// Every bitmap the renderer holds goes to zero, so a switch away leaves nothing allocated.
function releaseSurface(surface: Surface | undefined): void {
  if (surface === undefined) {
    return
  }

  surface.canvas.remove()
  zeroCanvas(surface.offscreen)

  if (surface.background !== undefined) {
    zeroCanvas(surface.background.canvas)
  }

  surface.background = undefined
  surface.screens.release()
  releaseCharacterSprites()
}

// Paints one frame; true while the people's small motion runs.
function paintFrame(surface: Surface, sim: SimView, now: number): boolean {
  const pane = { w: surface.canvas.clientWidth, h: surface.canvas.clientHeight }
  const dpr = devicePixelRatio

  if (pane.w === 0 || pane.h === 0) {
    return false
  }

  resizeCanvas(surface.canvas, pane, dpr)

  const fit = placeCamera(surface, pane, dpr)
  const scene = buildPaintScene(surface, sim, fit.scale)
  const light = lightAt(sim.light.followsHour ? sim.light.hour : DAY_LIGHT_HOUR)
  const motion = {
    isOn: isCharacterMotionOn(sim.actors, { floor: sim.floor, now }),
    isReduced: reducedMotion.value,
  }

  const isFeeding = !motion.isReduced && feedKOf(sim.life, now) < 1

  paintFloor(surface, { sim, scene, light, stretch: fit.stretch, now, motion })
  blitFloor(surface, { sky: light.sky, dpr })

  return (
    motion.isOn ||
    sim.life.animatedFloors.includes(sim.floor) ||
    isFeeding ||
    (sim.floor === TEAM_FLOOR && isTeamMoving(sim.team, motion.isReduced))
  )
}

// The camera's fit for this pane, clamped and rounded to device pixels, reported to the overlays.
function placeCamera(surface: Surface, pane: Size, dpr: number): Fit {
  const camera = view.value
  const base = fitFloor(pane, dpr, breakpoint.value)
  const room = camera.room === undefined ? undefined : roomById(camera.room)
  const fit = resolveFit({ base, room: room?.rect, steps: camera.zoomSteps, pane, dpr })
  const center = clampPan(camera.center, fit.scale, pane)
  const originX = Math.round((pane.w / 2 - center.x * fit.scale) * dpr) / dpr
  const originY = Math.round((pane.h / 2 - center.y * fit.scale) * dpr) / dpr

  surface.placement = { scale: fit.scale, originX, originY }
  reportProjection({ pane, scale: fit.scale, baseScale: base.scale, originX, originY })

  return fit
}

function resolveFit(spec: {
  readonly base: Fit
  readonly room:
    | { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
    | undefined
  readonly steps: number
  readonly pane: Size
  readonly dpr: number
}): Fit {
  if (spec.room !== undefined) {
    return fitRoom(spec.room, spec.pane, spec.dpr)
  }

  return spec.steps === 0
    ? spec.base
    : toSnappedFit(spec.base.scale * ZOOM_STEP ** spec.steps, spec.dpr)
}

function buildPaintScene(surface: Surface, sim: SimView, scale: number): PaintScene {
  const lib = roomStatus.value.get('lib')?.runs[0]

  return {
    lit: sim.props.lit,
    isAnyLit: sim.props.lit.size > 0,
    minuteOfDay: sim.light.hour * MINUTES_PER_HOUR,
    scale,
    isPrinting: isPrintingRun(lib),
    notes: boardNotes.value,
    unread: unread.value ?? 0,
    agenda: agenda.value,
    screens: surface.screens,
    life: sim.life,
    detail: detailOf(scale),
  }
}

interface FloorJob {
  readonly sim: SimView
  readonly scene: PaintScene
  readonly light: LightRow
  readonly stretch: number
  readonly now: number
  readonly motion: { readonly isOn: boolean; readonly isReduced: boolean }
}

// Cached floor, back props, the y-sorted pieces, then one light pass.
function paintFloor(surface: Surface, job: FloorJob): void {
  const { offscreen } = surface
  const g = offscreen.getContext('2d')

  if (g === null) {
    return
  }

  if (offscreen.width !== WORLD.w * job.stretch || offscreen.height !== WORLD.h * job.stretch) {
    offscreen.width = WORLD.w * job.stretch
    offscreen.height = WORLD.h * job.stretch
  }

  g.setTransform(job.stretch, 0, 0, job.stretch, 0, 0)
  g.imageSmoothingEnabled = false
  g.clearRect(0, 0, WORLD.w, WORLD.h)
  g.drawImage(resolveBackground(surface, job), 0, 0)

  for (const piece of buildPieces(g, job)) {
    piece.draw()
  }

  paintOverPieces(g, job)

  const dropPct = indexDrop.value?.movePct

  paintLighting(g, {
    floor: job.sim.floor,
    lit: job.sim.props.lit,
    light: job.light,
    lampGlow: job.sim.props.lampGlow,
    isClosed: job.sim.props.isClosed,
    ...(dropPct === undefined ? {} : { dropPct }),
  })

  if (job.sim.floor === TEAM_FLOOR) {
    paintTeamGlow(g, job.sim.team)
    paintTeamTop(g, job.sim.team, { now: job.now, isReduced: job.motion.isReduced })
  }
}

// The tray, the printer's stack and the steam, and the papers in flight, over everything standing.
function paintOverPieces(g: CanvasRenderingContext2D, job: FloorJob): void {
  if (job.sim.floor === TRAY_FLOOR) {
    paintTray(g, job.sim.tray)
  }

  paintLifeOver(g, {
    life: job.sim.life,
    floor: job.sim.floor,
    now: job.now,
    isReduced: job.motion.isReduced,
  })

  paintPapers(
    g,
    job.sim.papers.filter((paper) => paper.floor === job.sim.floor),
    job.sim.alpha
  )
}

// Back props first in their list order, then props and people by their bottom edge.
function buildPieces(g: CanvasRenderingContext2D, job: FloorJob): Piece[] {
  const props = propsOn(job.sim.floor).filter((prop) => !isBaked(prop))
  const back = props.filter(isBackProp).map((prop) => ({
    sortY: Number.NEGATIVE_INFINITY,
    tie: 0,
    draw: () => paintProp(g, prop, job.scene),
  }))
  const standing = props
    .filter((prop) => !isBackProp(prop))
    .map((prop) => ({
      sortY: prop.sortY,
      tie: tieRankOf(prop),
      draw: () => paintProp(g, prop, job.scene),
    }))
  const actors = job.sim.actors
    .filter((actor) => actor.floor === job.sim.floor)
    .map((actor) => ({
      sortY: actor.at.y,
      tie: ACTOR_TIE_RANK,
      draw: () =>
        drawCharacter(g, actor, {
          scale: job.scene.scale,
          now: job.now,
          alpha: job.sim.alpha,
          isSelected: actor.id === selectedActor.value,
          motion: job.motion,
        }),
    }))

  const life = buildLifePieces(g, {
    life: job.sim.life,
    floor: job.sim.floor,
    alpha: job.sim.alpha,
    scale: job.scene.scale,
  })
  const team = job.sim.floor === TEAM_FLOOR ? buildTeamPieces(g, job.sim.team) : []

  return [
    ...back,
    ...[...standing, ...team, ...actors, ...life].sort(
      (a, b) => a.sortY - b.sortY || a.tie - b.tie
    ),
  ]
}

// The floor never moves under its props: rebuilt only when the floor shown changes.
function resolveBackground(surface: Surface, job: FloorJob): HTMLCanvasElement {
  const held = surface.background

  if (held?.floor === job.sim.floor) {
    return held.canvas
  }

  const canvas = held?.canvas ?? document.createElement('canvas')
  const g = canvas.getContext('2d')

  canvas.width = WORLD.w
  canvas.height = WORLD.h

  if (g !== null) {
    paintBuilding(g, job.sim.floor, (prop) => paintProp(g, prop, job.scene))
  }

  surface.background = { canvas, floor: job.sim.floor }

  return canvas
}

// The stage behind the frame, the sky through the north glass, then the stretched floor.
function blitFloor(
  surface: Surface,
  job: { readonly sky: readonly [string, string]; readonly dpr: number }
): void {
  const { context: g, canvas, placement } = surface
  const { scale, originX, originY } = placement
  const { sky } = job
  const gradient = g.createLinearGradient(0, FRAME_RECT.y, 0, WALL_BAND_PX)

  g.setTransform(1, 0, 0, 1, 0, 0)
  g.fillStyle = resolveTokens(surface).stage
  g.fillRect(0, 0, canvas.width, canvas.height)
  gradient.addColorStop(0, sky[0])
  gradient.addColorStop(1, sky[1])
  g.setTransform(scale * job.dpr, 0, 0, scale * job.dpr, originX * job.dpr, originY * job.dpr)
  g.fillStyle = gradient
  g.fillRect(0, FRAME_RECT.y, WORLD.w, WALL_BAND_PX - FRAME_RECT.y)
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.imageSmoothingEnabled = false
  g.drawImage(
    surface.offscreen,
    Math.round(originX * job.dpr),
    Math.round(originY * job.dpr),
    Math.round(WORLD.w * scale * job.dpr),
    Math.round(WORLD.h * scale * job.dpr)
  )
}

// The page's tokens are read once per scheme, never per frame.
function resolveTokens(surface: Surface): Tokens {
  const scheme = colorScheme.value

  if (surface.tokens?.scheme !== scheme) {
    surface.tokens = {
      scheme,
      stage: getComputedStyle(surface.canvas).getPropertyValue(STAGE_TOKEN),
    }
  }

  return surface.tokens
}

function resizeCanvas(canvas: HTMLCanvasElement, pane: Size, dpr: number): void {
  const width = Math.round(pane.w * dpr)
  const height = Math.round(pane.h * dpr)

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
}

function toScreen(surface: Surface | undefined, p: Point): ScreenPoint {
  const { scale, originX, originY } = surface?.placement ?? IDENTITY_FIT

  return { x: originX + p.x * scale, y: originY + p.y * scale }
}

function toWorld(surface: Surface | undefined, s: ScreenPoint): Point {
  const { scale, originX, originY } = surface?.placement ?? IDENTITY_FIT

  return { x: (s.x - originX) / scale, y: (s.y - originY) / scale }
}
