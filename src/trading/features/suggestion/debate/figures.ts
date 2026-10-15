import type { DebateClaim } from '@/trading/features/suggestion/debate/types'

const FIGURE_RE =
  /(\d+(?:[.,]\d+)*)\s*(%|nghìn tỷ|ngàn tỷ|tỷ|triệu|nghìn|ngàn|trillion|billion|million|thousand|tn|bn|m|k)?(?!\p{L})/giu
const SCALES: Readonly<Record<string, number>> = Object.freeze({
  'nghìn tỷ': 1e12,
  'ngàn tỷ': 1e12,
  trillion: 1e12,
  tn: 1e12,
  tỷ: 1e9,
  billion: 1e9,
  bn: 1e9,
  triệu: 1e6,
  million: 1e6,
  m: 1e6,
  nghìn: 1e3,
  ngàn: 1e3,
  thousand: 1e3,
  k: 1e3,
})
const PERCENT = '%'
const GROUP_DIGITS = 3
/** A bare integer below this is a count or a day, not a figure a source prints. */
const SMALLEST_BARE_FIGURE = 100
const FIRST_YEAR = 1900
const LAST_YEAR = 2100
const RELATIVE_EPSILON = 1e-9
const HALF = 0.5
const SEPARATORS_RE = /[.,]/g
const SEPARATOR_RE = /[.,]/

interface Reading {
  readonly value: number
  /** Half the last printed digit, so a rounded restatement still matches its source. */
  readonly tolerance: number
}

interface Figure {
  /** Every value the printed digits can mean: `1,234` is a thousand-and-some in English and one
   *  and a bit in Vietnamese, and only the evidence can say which. */
  readonly readings: readonly Reading[]
  readonly percent: boolean
}

/** Figures in the material claims that no figure in the evidence matches. Derived numbers (a sum,
 *  a gap) count too, which is why this raises an information caveat and never a verdict. */
export function unmatchedFigureCount(claims: readonly DebateClaim[], evidence: string): number {
  const known = figuresIn(evidence)

  return claims
    .flatMap((claim) => figuresIn(claim.text))
    .filter((figure) => !known.some((candidate) => isSameFigure(figure, candidate))).length
}

function figuresIn(text: string): readonly Figure[] {
  return [...text.matchAll(FIGURE_RE)].flatMap((match) => {
    const figure = toFigure(match[1] ?? '', match[2]?.toLowerCase())

    return figure === undefined ? [] : [figure]
  })
}

function toFigure(digits: string, unit: string | undefined): Figure | undefined {
  const readings = readingsOf(digits)
  const scale = unit === undefined || unit === PERCENT ? 1 : (SCALES[unit] ?? 1)
  const [first] = readings

  if (first === undefined || (unit === undefined && isNoise(first, digits))) {
    return undefined
  }

  return {
    readings: readings.map((reading) => ({
      value: reading.value * scale,
      tolerance: reading.tolerance * scale,
    })),
    percent: unit === PERCENT,
  }
}

/** The last separator is the decimal one when both kinds appear; a lone separator before exactly
 *  three digits could be either. */
function readingsOf(digits: string): readonly Reading[] {
  const lastDot = digits.lastIndexOf('.')
  const lastComma = digits.lastIndexOf(',')
  const decimalAt = Math.max(lastDot, lastComma)

  if (decimalAt < 0) {
    return [{ value: Number(digits), tolerance: HALF }]
  }

  const whole = digits.slice(0, decimalAt).replace(SEPARATORS_RE, '')
  const fraction = digits.slice(decimalAt + 1)
  const asDecimal = {
    value: Number(`${whole}.${fraction}`),
    tolerance: HALF * 10 ** -fraction.length,
  }
  const asGrouped = { value: Number(digits.replace(SEPARATORS_RE, '')), tolerance: HALF }
  const both = lastDot >= 0 && lastComma >= 0
  const ambiguous = !both && fraction.length === GROUP_DIGITS

  return (ambiguous ? [asDecimal, asGrouped] : [asDecimal]).filter((reading) =>
    Number.isFinite(reading.value)
  )
}

function isNoise(reading: Reading, digits: string): boolean {
  const isWhole = !SEPARATOR_RE.test(digits)
  const isYear = reading.value >= FIRST_YEAR && reading.value <= LAST_YEAR

  return isWhole && (reading.value < SMALLEST_BARE_FIGURE || isYear)
}

function isSameFigure(claim: Figure, evidence: Figure): boolean {
  if (claim.percent !== evidence.percent) {
    return false
  }

  return claim.readings.some((stated) =>
    evidence.readings.some((printed) => isWithinRounding(stated, printed))
  )
}

/** Whichever side printed fewer digits sets the tolerance: a claim may round its source, and it may
 *  also quote a figure the source printed rounded. */
function isWithinRounding(stated: Reading, printed: Reading): boolean {
  const tolerance = Math.max(stated.tolerance, printed.tolerance)
  const slack = Math.abs(printed.value) * RELATIVE_EPSILON

  return Math.abs(stated.value - printed.value) <= tolerance + slack
}
