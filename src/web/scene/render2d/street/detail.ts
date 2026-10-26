import type { Point } from '@/web/scene/types'
import { zeroCanvas } from '@/web/scene/renderer'

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

// Oldest first: past the cap the first entry goes.
const sprites = new Map<string, StreetSprite>()

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
  const key = `${spec.key}@${spec.box.pxPerWorld}`
  const sprite = sprites.get(key) ?? createSprite(key, spec.box, paint)

  if (sprite !== undefined) {
    g.drawImage(
      sprite.canvas,
      spec.at.x - sprite.anchor.x,
      spec.at.y - sprite.anchor.y,
      sprite.w,
      sprite.h
    )
  }
}

/** Zeroes every cached sprite's pixels and empties the cache. */
export function releaseStreetSprites(): void {
  for (const sprite of sprites.values()) {
    zeroCanvas(sprite.canvas)
  }

  sprites.clear()
}

function createSprite(
  key: string,
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

  const sprite = { canvas, anchor: box.anchor, w: box.w, h: box.h }

  sprites.set(key, sprite)
  evictOldest()

  return sprite
}

function evictOldest(): void {
  if (sprites.size <= MAX_STREET_SPRITES) {
    return
  }

  const [oldestKey, oldest] = sprites.entries().next().value ?? []

  if (oldestKey !== undefined && oldest !== undefined) {
    zeroCanvas(oldest.canvas)
    sprites.delete(oldestKey)
  }
}
