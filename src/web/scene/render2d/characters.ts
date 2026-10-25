import type { FrameSpec, Material } from '@/web/scene/render2d/figure-spec'
import type { HeldKind, PoseFrame } from '@/web/scene/sim/actors/poses'
import type { ActorView, FloorId, HeldItem } from '@/web/scene/types'
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
  isAmbientBout,
  isBlinking,
  isBreathDown,
  isPoseMoving,
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
  WORK_RIM,
} from '@/web/scene/sprites/palette'
import { type Look, lookOf, PANTS_OF } from '@/web/scene/sprites/parts'
import { seedOf } from '@/web/scene/world/rng'

// Enough for every person on a busy floor in every frame they cycle through, with room to spare.
const MAX_SPRITES = 640
const KEY_SEPARATOR = '|'
const SELECT_RING_W = 14
const SHADOW_W = 14
const SHADOW_H = 3
const SELECT_RING = OUTLINE
// A stamped sheet takes the action's hue: a buy in Up, a reduce in Down, a hold in Ink.
const STAMP_TONES = Object.freeze({ buy: '#0B7532', reduce: '#C1231A', hold: OUTLINE })
// Face details shade with the skin under them, so a dot eye never splits the head's bands.
const SKIN_DETAILS: ReadonlySet<Material> = new Set([
  'brow',
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
const HELD_OF: Readonly<Record<HeldItem, HeldKind | undefined>> = Object.freeze({
  card: 'item',
  calculator: 'item',
  pen: 'item',
  phone: undefined,
  headset: 'item',
  wallet: 'item',
  box: 'box',
})

type Band = 0 | 1 | 2

const sprites = new Map<string, HTMLCanvasElement>()

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
  readonly isSelected: boolean
  readonly motion: CharacterMotion
}

/** Whether the floor's people blink and breathe now: always while one works, walks or plays a
 *  moving pose, otherwise only inside an ambient bout, so a quiet floor asks for no frame. */
export function isCharacterMotionOn(
  actors: readonly ActorView[],
  at: { readonly floor: FloorId; readonly now: number }
): boolean {
  const here = actors.filter((actor) => actor.floor === at.floor)

  if (here.length === 0) {
    return false
  }

  const isBusy = here.some((actor) => actor.working || isWalking(actor) || isPoseMoving(actor.pose))

  return isBusy || isAmbientBout(at.floor, at.now)
}

/** Draws one person standing on its feet between `actor.prev` and `actor.at`, a ring under the
 *  selected one, turned the way it faces. */
export function drawCharacter(
  g: CanvasRenderingContext2D,
  actor: ActorView,
  frame: CharacterFrame
): void {
  const image = characterSprite(lookOf(actor.id, actor.role), toFrameSpec(actor, frame))
  const x = Math.round(actor.prev.x + (actor.at.x - actor.prev.x) * frame.alpha)
  const y = Math.round(actor.prev.y + (actor.at.y - actor.prev.y) * frame.alpha)

  g.fillStyle = SHADOW
  g.fillRect(x - SHADOW_W / 2, y - 1, SHADOW_W, SHADOW_H)

  if (frame.isSelected) {
    g.fillStyle = SELECT_RING
    g.fillRect(x - SELECT_RING_W / 2, y, SELECT_RING_W, 1)
  }

  if (actor.facing !== 'left') {
    g.drawImage(image, x - SPRITE_W / 2, y - SPRITE_H)
    return
  }

  g.save()
  g.translate(x * 2, 0)
  g.scale(-1, 1)
  g.drawImage(image, x - SPRITE_W / 2, y - SPRITE_H)
  g.restore()
}

/** One 24 by 32 sprite of `look` in `frame`, from a bounded cache: the least recently drawn goes
 *  first. */
export function characterSprite(look: Look, frame: FrameSpec): CanvasImageSource {
  const key = spriteKey(look, frame)
  const held = sprites.get(key)

  if (held !== undefined) {
    sprites.delete(key)
    sprites.set(key, held)

    return held
  }

  const canvas = buildSprite(look, frame)

  sprites.set(key, canvas)

  for (const [oldest, sprite] of sprites) {
    if (sprites.size <= MAX_SPRITES) {
      break
    }

    zeroCanvas(sprite)
    sprites.delete(oldest)
  }

  return canvas
}

/** Zeroes and drops the cached sprites; the next draw rebuilds them. */
export function releaseCharacterSprites(): void {
  for (const sprite of sprites.values()) {
    zeroCanvas(sprite)
  }

  sprites.clear()
}

function toFrameSpec(actor: ActorView, frame: CharacterFrame): FrameSpec {
  const seed = seedOf(actor.id)
  const isMoving = isWalking(actor)
  const isAnimated = frame.motion.isOn && !frame.motion.isReduced
  const clock = { seed, sinceMs: actor.poseSince, nowMs: isAnimated ? frame.now : actor.poseSince }
  const pose = poseFrameAt(actor.pose, clock)
  const gait = isMoving ? poseFrameAt('walk', { ...clock, nowMs: frame.now }).gait : pose.gait

  return {
    ...pose,
    ...(gait === undefined ? {} : { gait }),
    ...heldOf(actor, pose),
    isBack: actor.facing === 'up' && pose.isFront !== true,
    isBob: isAnimated && !isMoving && isBreathDown(seed, frame.now),
    isBlink: frame.motion.isOn && isBlinking(seed, frame.now),
    isWorking: actor.working,
    finish: seed % PHONE_FINISHES.length,
  }
}

function isWalking(actor: ActorView): boolean {
  return actor.prev.x !== actor.at.x || actor.prev.y !== actor.at.y
}

// A sheet in hand, else what the actor carries: a phone is read in both hands unless the pose
// already holds one.
function heldOf(actor: ActorView, pose: PoseFrame): Pick<FrameSpec, 'hold' | 'phone' | 'sheet'> {
  const sheet: Pick<FrameSpec, 'sheet'> =
    actor.sheet === undefined ? {} : { sheet: actor.sheet.action ?? 'blank' }

  if (pose.hold !== undefined || actor.item === undefined) {
    return sheet
  }

  if (actor.item === 'phone') {
    return pose.phone === undefined ? { ...sheet, phone: 'read' } : sheet
  }

  const hold = HELD_OF[actor.item]

  return hold === undefined ? sheet : { ...sheet, hold }
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
    case 'brow':
      return RAMP.hair[look.hairTone][2]
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
        : STAMP_TONES[frame.sheet]
    default:
      return isFlat(material) ? PALETTE[material] : RAMP[material][band]
  }
}

function isFlat(material: Material): material is keyof typeof PALETTE {
  return Object.hasOwn(PALETTE, material)
}

function zeroCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}
