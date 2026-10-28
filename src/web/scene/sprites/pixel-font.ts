/** The 3x5 bitmap font the small devices print with: digits, capitals and a few signs. Each glyph
 *  is five rows of three bits, one octal digit a row. */
const GLYPH_ROWS: Readonly<Record<string, string>> = Object.freeze({
  A: '25755',
  B: '65656',
  C: '34443',
  D: '65556',
  E: '74647',
  F: '74644',
  G: '34553',
  H: '55755',
  I: '72227',
  J: '11152',
  K: '55655',
  L: '44447',
  M: '57755',
  N: '75555',
  O: '25552',
  P: '65644',
  Q: '25573',
  R: '65655',
  S: '34216',
  T: '72222',
  U: '55557',
  V: '55552',
  W: '55775',
  X: '55255',
  Y: '55222',
  Z: '71247',
  '0': '75557',
  '1': '26227',
  '2': '71747',
  '3': '71717',
  '4': '55711',
  '5': '74717',
  '6': '74757',
  '7': '71122',
  '8': '75757',
  '9': '75717',
  '.': '00002',
  ',': '00024',
  '▲': '00270',
  '▼': '07200',
  ':': '02020',
  '-': '00700',
  '+': '02720',
  '%': '51245',
  '/': '11244',
})
const GLYPH_W = 3
const GLYPH_H = 5
const ADVANCE = 4
const BITS = 3
const FOLD_MARKS = /\p{M}/gu

/** How many dots wide `text` prints. */
export function pixelTextWidth(text: string): number {
  return Math.max(0, [...text].length * ADVANCE - 1)
}

/** Prints `text` from its top-left corner `at`, `dot` world px a dot (one unless given); accents
 *  fold away and an unknown sign leaves its cell blank. */
export function paintPixelText(
  g: CanvasRenderingContext2D,
  text: string,
  at: { readonly x: number; readonly y: number; readonly color: string; readonly dot?: number }
): void {
  const dot = at.dot ?? 1

  g.fillStyle = at.color

  let x = at.x

  for (const sign of text.normalize('NFD').replace(FOLD_MARKS, '').toUpperCase()) {
    const rows = GLYPH_ROWS[sign] ?? ''

    for (let row = 0; row < rows.length && row < GLYPH_H; row++) {
      const bits = Number(rows[row])

      for (let column = 0; column < GLYPH_W; column++) {
        if ((bits >> (BITS - 1 - column)) & 1) {
          g.fillRect(x + column * dot, at.y + row * dot, dot, dot)
        }
      }
    }

    x += ADVANCE * dot
  }
}
