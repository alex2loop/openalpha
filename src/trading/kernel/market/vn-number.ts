const VN_NUMBER_RE = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g

export interface VnNumberToken {
  readonly value: number
  readonly start: number
  readonly end: number
}

/** Dot thousands, comma decimal: `1.059,5` is 1059.5, `4,500` is 4.5. */
export function parseVnNumber(raw: string): number {
  return Number.parseFloat(raw.replaceAll('.', '').replace(',', '.'))
}

/** Every number in the text, in order, with where it sits. */
export function vnNumberTokensIn(text: string): readonly VnNumberToken[] {
  return [...text.matchAll(VN_NUMBER_RE)].map((match) => {
    const start = match.index ?? 0

    return { value: parseVnNumber(match[0]), start, end: start + match[0].length }
  })
}
