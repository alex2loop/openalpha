/** A tertiary button's trailing mark: it leads somewhere. */
export const NEXT_GLYPH = '›'
/** The mark that leads back, or to the left. */
export const PREVIOUS_GLYPH = '‹'
/** The office camera's zoom marks. */
export const ZOOM_IN_GLYPH = '+'
export const ZOOM_OUT_GLYPH = '−'
export const RESET_VIEW_GLYPH = '⟲'
/** The key cap of the key that leaves a room. */
export const ESCAPE_KEY_CAP = 'Esc'
/** The other key caps the shortcut list prints. */
export const TAB_KEY_CAP = 'Tab'
export const ENTER_KEY_CAP = 'Enter'
export const CONTROL_KEY_CAP = 'Ctrl'
export const COMMAND_KEY_CAP = '⌘'
export const UP_KEY_CAP = '↑'
export const DOWN_KEY_CAP = '↓'
export const LEFT_KEY_CAP = '←'
export const RIGHT_KEY_CAP = '→'
export const SHIFT_KEY_CAP = 'Shift'
/** The mark over a person when something needs a look. */
export const ATTENTION_MARK = '!'
/** Ends a line cut short; the whole of it is a click away. */
export const TRUNCATION_MARK = '...'
/** Stands in for a number the page could not read; never a zero. */
export const ABSENT_CELL = '—'
/** Leads a rise and a fall; a move that rounds to zero carries neither. */
export const UP_GLYPH = '▲'
export const DOWN_GLYPH = '▼'
/** Lead a lit screen's terminal lines: the command, the step under way, a step done. */
export const PROMPT_GLYPH = '$'
export const STEP_GLYPH = '→'
export const DONE_GLYPH = '✓'
/** The unit after a temperature. */
export const DEGREE_C = '°C'
/** Separates the segments of one line. */
const INLINE_SEPARATOR = '·'
const INLINE_JOINER = ` ${INLINE_SEPARATOR} `
const LIST_SEPARATOR = ', '

export function joinInline(segments: readonly string[]): string {
  return segments.join(INLINE_JOINER)
}

/** The segments of one inline line, as `joinInline` and the daemon's rows join them. */
export function splitInline(line: string): readonly string[] {
  return line.split(INLINE_JOINER)
}

/** Names in a sentence: "Ngân hàng, Bất động sản". */
export function joinList(items: readonly string[]): string {
  return items.join(LIST_SEPARATOR)
}
