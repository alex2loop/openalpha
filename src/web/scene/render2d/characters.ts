import type { ActorView } from '@/web/scene/types'

// The figure every person shares until their own look is drawn: 24 by 32 world px, feet at the
// bottom centre.
const SPRITE_W = 24
const SPRITE_H = 32
const OUTLINE = '#2B2433'
const BODY = '#9296AA'
const HEAD = '#F6D3B3'
const WORK_RIM = '#8FB4FF'

let sprite: HTMLCanvasElement | undefined

/** The zoom and the frame time a person is drawn at: they pick the sprite's detail and pose frame
 *  once the looks are drawn. */
interface CharacterFrame {
  readonly scale: number
  readonly now: number
}

/** Draws one person standing on its feet at `actor.at`, the working rim while it works. */
export function drawCharacter(
  g: CanvasRenderingContext2D,
  actor: ActorView,
  _frame: CharacterFrame
): void {
  const image = sprite ?? buildSprite()

  sprite = image
  g.drawImage(image, Math.round(actor.at.x - SPRITE_W / 2), Math.round(actor.at.y - SPRITE_H))

  if (actor.working) {
    g.fillStyle = WORK_RIM
    g.fillRect(Math.round(actor.at.x - 5), Math.round(actor.at.y - SPRITE_H + 4), 10, 1)
  }
}

/** Zeroes and drops the cached sprites; the next draw rebuilds them. */
export function releaseCharacterSprites(): void {
  if (sprite !== undefined) {
    sprite.width = 0
    sprite.height = 0
  }

  sprite = undefined
}

function buildSprite(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const c = canvas.getContext('2d')

  canvas.width = SPRITE_W
  canvas.height = SPRITE_H

  if (c !== null) {
    c.fillStyle = OUTLINE
    c.fillRect(5, 3, 14, 12)
    c.fillRect(6, 14, 12, 15)
    c.fillStyle = HEAD
    c.fillRect(6, 4, 12, 10)
    c.fillStyle = BODY
    c.fillRect(7, 15, 10, 13)
  }

  return canvas
}
