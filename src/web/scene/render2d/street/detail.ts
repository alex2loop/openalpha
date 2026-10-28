import type { Point } from '@/web/scene/types'
import { createSpriteCache } from '@/web/scene/sprites/sprite-cache'

// Device px per world px where the street's detail steps up: flat colours below the first, signs
// and wordmarks from it, fine detail from the second.
const DETAIL_STEPS = [2.2, 5] as const
// The static canvas's px per world px at each detail level: a close zoom paints it finer, and the
// moving canvas carries what must be sharp beyond that.
const STATIC_PX_PER_WORLD = [1, 1.5, 2] as const
const MAX_STREET_SPRITES = 640

export type StreetDetail = 0 | 1 | 2

/** A small picture painted once and drawn many times: its canvas, the world point it hangs from
 *  (`anchor`, from its top-left) and its size in world px. */
interface StreetSprite {
  readonly canvas: HTMLCanvasElement
  readonly anchor: Point
  readonly w: number
  readonly h: number
}

/** What a sprite covers in world px around its anchor, and the px per world px it is painted at. */
interface SpriteBox {
  readonly w: number
  readonly h: number
  readonly anchor: Point
  readonly pxPerWorld: number
}

const sprites = createSpriteCache<StreetSprite>({
  max: MAX_STREET_SPRITES,
  canvasOf: (sprite) => sprite.canvas,
})

export function detailOfPx(devicePxPerWorld: number): StreetDetail {
  if (devicePxPerWorld >= DETAIL_STEPS[1]) {
    return 2
  }

  return devicePxPerWorld >= DETAIL_STEPS[0] ? 1 : 0
}

export function staticPxOf(detail: StreetDetail): number {
  return STATIC_PX_PER_WORLD[detail]
}

/** Draws the sprite keyed `key` at its resolution, painting it first with `paint` (in world px,
 *  origin at the anchor) when the cache does not hold it. */
export function drawSprite(
  g: CanvasRenderingContext2D,
  spec: { readonly key: string; readonly box: SpriteBox; readonly at: Point },
  paint: (sprite: CanvasRenderingContext2D) => void
): void {
  const sprite = sprites.obtain(spriteKeyOf(spec.key, spec.box.pxPerWorld), () =>
    createSprite(spec.box, paint)
  )

  if (sprite !== undefined) {
    blitSprite(g, sprite, spec.at)
  }
}

/** The cache key of the sprite keyed `key` painted at `pxPerWorld`. */
export function spriteKeyOf(key: string, pxPerWorld: number): string {
  return `${key}@${pxPerWorld}`
}

/** Draws the cached sprite under `fullKey` (from `spriteKeyOf`) at `at`; false when the cache
 *  does not hold it, so a caller on a hot path builds nothing until it must paint. */
export function drawHeldSprite(g: CanvasRenderingContext2D, fullKey: string, at: Point): boolean {
  const sprite = sprites.get(fullKey)

  if (sprite !== undefined) {
    blitSprite(g, sprite, at)
  }

  return sprite !== undefined
}

function blitSprite(g: CanvasRenderingContext2D, sprite: StreetSprite, at: Point): void {
  g.drawImage(sprite.canvas, at.x - sprite.anchor.x, at.y - sprite.anchor.y, sprite.w, sprite.h)
}

/** Zeroes every cached sprite's pixels and empties the cache. */
export function releaseStreetSprites(): void {
  sprites.clear()
}

function createSprite(
  box: SpriteBox,
  paint: (sprite: CanvasRenderingContext2D) => void
): StreetSprite | undefined {
  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d')

  if (g === null) {
    return undefined
  }

  canvas.width = Math.max(1, Math.ceil(box.w * box.pxPerWorld))
  canvas.height = Math.max(1, Math.ceil(box.h * box.pxPerWorld))
  g.scale(box.pxPerWorld, box.pxPerWorld)
  g.translate(box.anchor.x, box.anchor.y)
  paint(g)

  return { canvas, anchor: box.anchor, w: box.w, h: box.h }
}
