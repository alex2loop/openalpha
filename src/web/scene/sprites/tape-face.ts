import { computed, type ReadonlySignal } from '@preact/signals'

import type { Size } from '@/web/scene/types'
import { writeAll } from '@/web/scene/sprites/face-text'
import { moveToneOf } from '@/web/scene/sprites/palette'
import { colorScheme, colourPair } from '@/web/state/prefs'
import { tapeRows } from '@/web/state/tape'
import { formatSignedPercent, toneOfPercent } from '@/web/text/figures'

// The alert desk's price board shows the tape's first rows.
const BOARD_ROWS = 4
const NAME = '#EEF0FA'
const FLAT = '#E9ECF8'
const UP_MARK = '▲'
const DOWN_MARK = '▼'

/** One row of the board: the name, its move as printed, and which way it went. */
interface BoardRow {
  readonly name: string
  readonly move: string
  readonly tone: 'up' | 'down' | 'flat'
}

/** The rows the alert desk's board reads, and the signature its face is cached by. */
interface TapeBoard {
  readonly sig: string
  readonly rows: readonly BoardRow[]
}

/** The tape's first rows for the wall board, derived once per change of the tape or the page's
 *  up and down colours. */
export const tapeBoard: ReadonlySignal<TapeBoard> = computed(() => {
  const rows = tapeRows.value.slice(0, BOARD_ROWS).map((row) => ({
    name: row.ticker,
    move: formatSignedPercent(row.changePct),
    tone: toneOfPercent(row.changePct),
  }))

  return {
    sig: [colorScheme.value, colourPair.value, ...rows.map((r) => `${r.name}${r.move}`)].join('|'),
    rows,
  }
})

/** The board's text on its panel: a row a name and its move, or, too small to read, how many
 *  rose and fell. */
export function paintTapeFace(
  c: CanvasRenderingContext2D,
  size: Size,
  view: { readonly board: TapeBoard; readonly isTiny: boolean }
): void {
  const { w, h } = size
  const { rows } = view.board

  if (rows.length === 0) {
    return
  }

  if (view.isTiny) {
    const up = rows.filter((row) => row.tone === 'up').length
    const down = rows.filter((row) => row.tone === 'down').length
    const look = { align: 'center', weight: 700 } as const

    writeAll(c, [
      [`${UP_MARK}${up}`, w * 0.28, h / 2, h * 0.38, { ...look, color: moveToneOf('up') }],
      [`${DOWN_MARK}${down}`, w * 0.72, h / 2, h * 0.38, { ...look, color: moveToneOf('down') }],
    ])
    return
  }

  const pad = h * 0.07
  const rowH = (h - pad * 2) / rows.length
  const fontPx = rowH * 0.5

  writeAll(
    c,
    rows.flatMap((row, i) => {
      const y = pad + rowH * (i + 0.5)
      const color = row.tone === 'flat' ? FLAT : moveToneOf(row.tone)

      return [
        [row.name, pad, y, fontPx, { color: NAME, weight: 700, maxW: w * 0.55 }],
        [row.move, w - pad, y, fontPx * 0.85, { color, weight: 600, align: 'right' }],
      ] as const
    })
  )
}
