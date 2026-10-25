import type { ActorView } from '@/web/scene/types'

// The figure every person shares until their own look is drawn: 24 by 32 world px, feet at the
// bottom centre.
const SPRITE_W = 24
const SPRITE_H = 32
const OUTLINE = '#2B2433'
const BODY = '#9296AA'
const HEAD = '#F6D3B3'
const WORK_RIM = '#8FB4FF'
const SHEET = '#F7F5EF'
const SELECT_RING = '#2B2433'
const ITEM = '#6B7280'
// A stamped sheet takes the action's hue: a buy in Up, a reduce in Down, a hold in Ink.
const STAMP_TONES = Object.freeze({ buy: '#0B7532', reduce: '#C1231A', hold: OUTLINE })
const SELECT_RING_W = 14
const HAND_RISE_PX = 14

let sprite: HTMLCanvasElement | undefined

/** The zoom and the frame time a person is drawn at: they pick the sprite's detail and pose frame
 *  once the looks are drawn. */
interface CharacterFrame {
  readonly scale: number
  readonly now: number
  /** How far the frame sits between the last two sim steps. */
  readonly alpha: number
  readonly isSelected: boolean
}

/** Draws one person standing on its feet between `actor.prev` and `actor.at`, the working rim
 *  while it works, a ring under the selected one, and what it holds. */
export function drawCharacter(
  g: CanvasRenderingContext2D,
  actor: ActorView,
  frame: CharacterFrame
): void {
  const image = sprite ?? buildSprite()
  const x = Math.round(actor.prev.x + (actor.at.x - actor.prev.x) * frame.alpha)
  const y = Math.round(actor.prev.y + (actor.at.y - actor.prev.y) * frame.alpha)

  sprite = image

  if (frame.isSelected) {
    g.fillStyle = SELECT_RING
    g.fillRect(x - SELECT_RING_W / 2, y, SELECT_RING_W, 1)
  }

  g.drawImage(image, x - SPRITE_W / 2, y - SPRITE_H)

  if (actor.working) {
    g.fillStyle = WORK_RIM
    g.fillRect(x - 5, y - SPRITE_H + 4, 10, 1)
  }

  drawHeld(g, actor, { x, y: y - HAND_RISE_PX })
}

// A sheet (with its stamp once stamped) or a small item at the hand.
function drawHeld(
  g: CanvasRenderingContext2D,
  actor: ActorView,
  hand: { x: number; y: number }
): void {
  if (actor.sheet !== undefined) {
    g.fillStyle = SHEET
    g.fillRect(hand.x + 4, hand.y, 4, 5)

    if (actor.sheet.action !== undefined) {
      g.fillStyle = STAMP_TONES[actor.sheet.action]
      g.fillRect(hand.x + 5, hand.y + 2, 2, 2)
    }

    return
  }

  if (actor.item !== undefined) {
    g.fillStyle = ITEM
    g.fillRect(hand.x + 4, hand.y + 1, 3, 3)
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
