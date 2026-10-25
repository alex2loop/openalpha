/** A tertiary button's trailing mark: it leads somewhere. */
export const NEXT_GLYPH = '›'
/** Stands in for a number the page could not read; never a zero. */
export const ABSENT_CELL = '—'
/** Separates the segments of one line. */
const INLINE_SEPARATOR = '·'

export function joinInline(segments: readonly string[]): string {
  return segments.join(` ${INLINE_SEPARATOR} `)
}
