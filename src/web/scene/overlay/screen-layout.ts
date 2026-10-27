import type { ScreenLine } from '@/web/scene/overlay-types'
import type { Rect } from '@/web/scene/types'
import { FLAT_SCREEN_H } from '@/web/scene/world/desk-spots'

// The mockup's 2D terminal. A screen big enough to read sets text: a title bar a seventh of its
// height, the rest in two rows (else one) of the largest font that leaves eight "n" across, never
// under the least font that reads. A smaller one sets bars, a pixel of its flat screen a row.
const TEXT_MIN_PX = 5.5
const TOP_SHARE = 1 / 7
const TOP_MIN_PX = 3
const PAD_SHARE = 1 / 40
const PAD_MIN_PX = 1
const LEAD = 1.3
const ROW_FITS = [2, 1] as const
// Eight "n" of the sans face, in ems.
const SAMPLE_EM = 4.64
// A bar is a little over half a pixel for each character.
const BAR_PER_CHAR = 0.55
const BAR_MIN_PX = 2
// A bar leaves a pixel at either side, and sits on pixel row 2 and every second row after it, under
// the title bar's row.
const BAR_INSET_PX = 2
const BAR_TOP_PX = 2
const BAR_PITCH_PX = 2

/** How a lit terminal is set: text rows, or bars when the screen is too small for text. */
export type TerminalLayout =
  | {
      readonly kind: 'text'
      readonly fs: number
      readonly lh: number
      readonly top: number
      readonly pad: number
      readonly rows: number
    }
  | {
      readonly kind: 'bars'
      /** CSS px of one pixel of the flat screen. */
      readonly unit: number
      readonly rows: number
      /** The screen's width in those pixels. */
      readonly cols: number
    }

export function terminalLayoutOf(rect: Rect): TerminalLayout {
  const top = Math.max(TOP_MIN_PX, Math.round(rect.h * TOP_SHARE))
  const pad = Math.max(PAD_MIN_PX, Math.round(rect.w * PAD_SHARE))
  const avail = rect.h - top - pad
  const fitW = Math.floor((rect.w - pad * 2) / SAMPLE_EM)

  for (const rows of ROW_FITS) {
    const fs = Math.min(Math.floor(avail / (rows * LEAD)), fitW)

    if (fs >= TEXT_MIN_PX) {
      const lh = Math.round(fs * LEAD)

      return { kind: 'text', fs, lh, top, pad, rows: Math.max(1, Math.floor(avail / lh)) }
    }
  }

  const unit = rect.h / FLAT_SCREEN_H

  return {
    kind: 'bars',
    unit,
    rows: Math.max(1, Math.floor((FLAT_SCREEN_H - BAR_TOP_PX) / BAR_PITCH_PX)),
    cols: rect.w / unit,
  }
}

/** The pixel row a bar sits on, under the title bar. */
export function barRowOf(row: number): number {
  return BAR_TOP_PX + row * BAR_PITCH_PX
}

/** A line's bar, in pixels of the flat screen: wider with the line, never past the screen. */
export function barWidthOf(text: string, cols: number): number {
  return Math.max(BAR_MIN_PX, Math.min(cols - BAR_INSET_PX, Math.round(text.length * BAR_PER_CHAR)))
}

/** The last `rows` lines the screen has, the newest typed to `chars` characters. */
export function shownLinesOf(
  lines: readonly ScreenLine[],
  chars: number,
  rows: number
): readonly ScreenLine[] {
  const last = lines.at(-1)

  if (last === undefined) {
    return []
  }

  return [...lines.slice(0, -1), { ...last, text: last.text.slice(0, chars) }].slice(-rows)
}
