import type { FrameSpec, Material } from '@/web/scene/render2d/figure-spec'
import type { ActorId, ActorView } from '@/web/scene/types'
import { buildFigure } from '@/web/scene/render2d/figure'
import { buildMascot } from '@/web/scene/render2d/mascot'
import {
  type Cells,
  cellAt,
  createCells,
  isEdge,
  paintCells,
  SPRITE_H,
  SPRITE_W,
} from '@/web/scene/render2d/pixel-grid'
import {
  inHandOf,
  isActorWalking,
  isBlinking,
  isBreathDown,
  poseFrameAt,
} from '@/web/scene/sim/actors/poses'
import {
  HELD_TONES,
  OUTLINE,
  OUTLINE_TOP,
  PALETTE,
  PHONE_FINISHES,
  RAMP,
  SHADOW,
  STATUS_TONES,
  stampToneOf,
  WORK_RIM,
} from '@/web/scene/sprites/palette'
import { type Look, lookOf, PANTS_OF } from '@/web/scene/sprites/parts'
import { createSpriteCache } from '@/web/scene/sprites/sprite-cache'
import { seedOf } from '@/web/scene/world/rng'

// Enough for every person on a busy floor in every frame they cycle through, with room to spare.
const MAX_SPRITES = 640
const KEY_SEPARATOR = '|'
const SHADOW_W = 14
const SHADOW_H = 3
// The status dot's radius: a fixed CSS size, kept between these world px; its colour fills this
// share of it inside the outline, the dot this far over the head.
const DOT_CSS_R = 5
const DOT_MIN_R = 1.5
const DOT_MAX_R = 3.4
const DOT_CORE = 0.66
const DOT_GAP_PX = 2
const DOT_MARK_SIDE_PX = 9
const DOT_MARK_RISE_PX = 1
// Face details shade with the skin under them, so a dot eye never splits the head's bands.
const SKIN_DETAILS: ReadonlySet<Material> = new Set([
  'glint',
  'eye',
  'mouth',
  'blush',
  'muzzle',
  'nose',
  'lens',
  'frame',
  'gold',
])

type Band = 0 | 1 | 2

const sprites = createSpriteCache<HTMLCanvasElement>({
  max: MAX_SPRITES,
  canvasOf: (sprite) => sprite,
})

/** Whether the people's small motion runs this frame, and whether the operator asked for less. */
interface CharacterMotion {
  readonly isOn: boolean
  readonly isReduced: boolean
}

/** The zoom and the frame time a person is drawn at. */
interface CharacterFrame {
  readonly scale: number
  readonly now: number
  /** How far the frame sits between the last two sim steps. */
  readonly alpha: number
  readonly motion: CharacterMotion
}

/** Draws one person standing on its feet between `actor.prev` and `actor.at`, a ring under the
 *  selected one, turned the way it faces. */
export function drawCharacter(
  g: CanvasRenderingContext2D,
  actor: ActorView,
  frame: CharacterFrame
): void {
  const image = characterSprite(lookOf(actor.id, actor.role, actor.look), toFrameSpec(actor, frame))

  if (image === undefined) {
    return
  }

  const x = Math.round(actor.prev.x + (actor.at.x - actor.prev.x) * frame.alpha)
  const y = Math.round(actor.prev.y + (actor.at.y - actor.prev.y) * frame.alpha)

  g.fillStyle = SHADOW
  g.fillRect(x - SHADOW_W / 2, y - 1, SHADOW_W, SHADOW_H)

  if (actor.facing === 'left') {
    g.save()
    g.translate(x * 2, 0)
    g.scale(-1, 1)
    g.drawImage(image, x - SPRITE_W / 2, y - SPRITE_H)
    g.restore()
  } else {
    g.drawImage(image, x - SPRITE_W / 2, y - SPRITE_H)
  }
}

/** Each person's status dot over the head, round as the mockup's, drawn over everything on the
 *  floor: small at floor zoom, readable close. */
export function paintStatusDots(
  g: CanvasRenderingContext2D,
  actors: readonly ActorView[],
  at: { readonly alpha: number; readonly scale: number; readonly marked: ReadonlySet<ActorId> }
): void {
  const r = Math.min(DOT_MAX_R, Math.max(DOT_MIN_R, DOT_CSS_R / at.scale))

  for (const actor of actors) {
    if (actor.status === undefined) {
      continue
    }

    const x = Math.round(actor.prev.x + (actor.at.x - actor.prev.x) * at.alpha)
    const y = Math.round(actor.prev.y + (actor.at.y - actor.prev.y) * at.alpha)
    // Beside an "!" the dot steps aside, as the mockup moves it, so the two never overlap.
    const isMarked = at.marked.has(actor.id)
    const cx = isMarked ? x + DOT_MARK_SIDE_PX : x
    const cy = y - SPRITE_H - (isMarked ? DOT_MARK_RISE_PX : Math.round(r) + DOT_GAP_PX)

    disc(g, { x: cx, y: cy, r, color: OUTLINE })
    disc(g, { x: cx, y: cy, r: r * DOT_CORE, color: STATUS_TONES[actor.status] })
  }
}

function disc(
  g: CanvasRenderingContext2D,
  at: { readonly x: number; readonly y: number; readonly r: number; readonly color: string }
): void {
  g.fillStyle = at.color
  g.beginPath()
  g.arc(at.x, at.y, at.r, 0, Math.PI * 2)
  g.fill()
}

/** One 24 by 32 sprite of `look` in `frame`, from a bounded cache; absent while a frame has no
 *  time left to build it. */
export function characterSprite(look: Look, frame: FrameSpec): CanvasImageSource | undefined {
  return sprites.obtain(spriteKey(look, frame), () => buildSprite(look, frame))
}

/** Zeroes and drops the cached sprites; the next draw rebuilds them. */
export function releaseCharacterSprites(): void {
  sprites.clear()
}

function toFrameSpec(actor: ActorView, frame: CharacterFrame): FrameSpec {
  const seed = seedOf(actor.id)
  const isMoving = isActorWalking(actor)
  const isAnimated = frame.motion.isOn && !frame.motion.isReduced
  const clock = { seed, sinceMs: actor.poseSince, nowMs: isAnimated ? frame.now : actor.poseSince }
  const pose = poseFrameAt(actor.pose, clock)
  const gait = isMoving ? poseFrameAt('walk', { ...clock, nowMs: frame.now }).gait : pose.gait

  return {
    ...pose,
    ...(gait === undefined ? {} : { gait }),
    ...inHandOf(actor, pose),
    isBack: actor.facing === 'up' && pose.isFront !== true,
    isBob: isAnimated && !isMoving && isBreathDown(seed, frame.now),
    isBlink: frame.motion.isOn && isBlinking(seed, frame.now),
    isWorking: actor.working,
    finish: seed % PHONE_FINISHES.length,
  }
}

function spriteKey(look: Look, frame: FrameSpec): string {
  return [
    look.body,
    look.hair,
    look.hairTone,
    look.shirt,
    look.prop,
    look.isMascot,
    frame.arms,
    frame.beat,
    frame.gait,
    frame.isAside,
    frame.isDown,
    frame.isShut,
    frame.isYawn,
    frame.isHop,
    frame.isWave,
    frame.headDrop,
    frame.phone,
    frame.hold,
    frame.sheet,
    frame.sheet === 'buy' || frame.sheet === 'reduce' ? stampToneOf(frame.sheet) : '',
    frame.isBack,
    frame.isBob,
    frame.isBlink,
    frame.isWorking,
    frame.finish,
  ].join(KEY_SEPARATOR)
}

function buildSprite(look: Look, frame: FrameSpec): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')

  canvas.width = SPRITE_W
  canvas.height = SPRITE_H

  if (g !== null) {
    paintCells(g, look.isMascot ? buildMascot(frame) : colourFigure(look, frame))
  }

  return canvas
}

// Cel bands per part, an exact one-pixel outline round the figure, and the working rim on it.
function colourFigure(look: Look, frame: FrameSpec): Cells<string> {
  const cells = buildFigure(look, frame)
  const colours = createCells<string>()

  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const material = cells[y * SPRITE_W + x]

      if (material !== undefined) {
        colours[y * SPRITE_W + x] = colourOf(look, { material, band: bandAt(cells, x, y), frame })
      } else if (isEdge(cells, x, y)) {
        colours[y * SPRITE_W + x] = isTopEdge(cells, x, y) ? OUTLINE_TOP : OUTLINE
      }
    }
  }

  if (frame.isWorking) {
    addWorkRim(colours)
  }

  return colours
}

// The lit band on a part's top row, the shade on its bottom row and right edge, the body between.
function bandAt(cells: Cells<Material>, x: number, y: number): Band {
  const me = groupOf(cellAt(cells, x, y))

  if (groupOf(cellAt(cells, x, y - 1)) !== me) {
    return 0
  }

  return groupOf(cellAt(cells, x, y + 1)) !== me || cellAt(cells, x + 1, y) === undefined ? 2 : 1
}

function groupOf(material: Material | undefined): Material | undefined {
  return material !== undefined && SKIN_DETAILS.has(material) ? 'skin' : material
}

function isTopEdge(cells: Cells<Material>, x: number, y: number): boolean {
  return (
    cellAt(cells, x, y + 1) !== undefined &&
    cellAt(cells, x, y - 1) === undefined &&
    cellAt(cells, x - 1, y) === undefined &&
    cellAt(cells, x + 1, y) === undefined
  )
}

// The outline's top and sides turn the working blue.
function addWorkRim(colours: Cells<string>): void {
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const isOuter =
        cellAt(colours, x, y - 1) === undefined ||
        cellAt(colours, x - 1, y) === undefined ||
        cellAt(colours, x + 1, y) === undefined

      if (colours[y * SPRITE_W + x] === OUTLINE && isOuter) {
        colours[y * SPRITE_W + x] = WORK_RIM
      }
    }
  }
}

function colourOf(
  look: Look,
  pixel: { readonly material: Material; readonly band: Band; readonly frame: FrameSpec }
): string {
  const { material, band, frame } = pixel
  const finish = PHONE_FINISHES[frame.finish] ?? PHONE_FINISHES[0]
  const held = HELD_TONES[frame.hold ?? 'item']

  switch (material) {
    case 'skin':
      return RAMP.skin[look.body][band]
    case 'hair':
      return RAMP.hair[look.hairTone][band]
    case 'shirt':
      return RAMP.shirt[look.shirt][band]
    case 'pants':
      return RAMP.pants[PANTS_OF[look.shirt]][band]
    case 'phoneBody':
      return finish[0]
    case 'phoneEdge':
      return finish[1]
    case 'phonePlate':
      return finish[2]
    case 'heldBody':
      return held[0]
    case 'heldBand':
      return held[1]
    case 'stamp':
      return frame.sheet === undefined || frame.sheet === 'blank'
        ? PALETTE.paper
        : stampToneOf(frame.sheet)
    default:
      return isFlat(material) ? PALETTE[material] : RAMP[material][band]
  }
}

function isFlat(material: Material): material is keyof typeof PALETTE {
  return Object.hasOwn(PALETTE, material)
}
