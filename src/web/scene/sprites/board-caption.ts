import { FONT } from '@/web/scene/sprites/face-text'

const CAPTION_INK = '#3A3F58'
const CAPTION_STEP = '#5E6BB0'
// A board's subject and its step, as its line joins them.
const CAPTION_SPLIT = ': '
const STEP_NUMBER = /(\d+)\/\d+/
// The title is about this share of the board's height; under this many CSS px only the number shows.
const CAPTION_SHARE = 0.115
const MIN_CAPTION_PX = 9

/** Whether a board `h` world px tall at `scale` CSS px per world px is too small for its title. */
export function isCaptionTiny(h: number, scale: number): boolean {
  return h * CAPTION_SHARE * scale < MIN_CAPTION_PX
}

/** The board's title in marker: the subject, then its step; far off, only the step's number, else
 *  the caption's first two letters. */
export function paintBoardCaption(
  g: CanvasRenderingContext2D,
  at: {
    readonly rect: {
      readonly x: number
      readonly y: number
      readonly w: number
      readonly h: number
    }
    readonly caption: string
    readonly isTiny: boolean
  }
): void {
  const { x, y, w, h } = at.rect
  const [head, step] = at.caption.split(CAPTION_SPLIT)

  g.fillStyle = CAPTION_INK

  if (at.isTiny) {
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `700 ${h * 0.5}px ${FONT}`
    g.fillText(STEP_NUMBER.exec(at.caption)?.[1] ?? at.caption.slice(0, 2), x + w / 2, y + h * 0.34)
    return
  }

  g.textAlign = 'left'
  g.textBaseline = 'alphabetic'
  g.font = `700 ${h * 0.2}px ${FONT}`
  g.fillText(step === undefined ? at.caption : (head ?? ''), x + w * 0.07, y + h * 0.28, w * 0.86)

  if (step !== undefined) {
    g.font = `600 ${h * 0.15}px ${FONT}`
    g.fillStyle = CAPTION_STEP
    g.fillText(step, x + w * 0.07, y + h * 0.48, w * 0.86)
  }
}
