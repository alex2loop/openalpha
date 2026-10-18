import { isInteractiveStdout, isQuiet, isUnicode, terminalWidth } from '@/cli/env'
import { truncate } from '@/core/utils/text'

const CLEAR_TRANSIENT_LINE = '\r\x1b[K'
const ERASE_TO_END = '\x1b[K'
// A command that answers faster than this never paints a frame, so an instant reply (a usage line,
// a rejected argument) is not preceded by a flash of progress.
const REVEAL_DELAY_MS = 150
export const SPINNER_INTERVAL_MS = 80
// A pipe or log cannot redraw a row, so each line it gets stays on screen: a long fan-out must not
// write one per instrument.
const LINE_PROGRESS_INTERVAL_MS = 10_000
// The frame glyph, its space, and one spare column: writing into the last cell wraps early on some
// terminals.
const LABEL_RESERVED_COLUMNS = 3
export const UNICODE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
export const ASCII_FRAMES = ['-', '\\', '|', '/'] as const

export interface Spinner {
  start(label: string): void
  stop(): void
}

export function createSpinner(write: (text: string) => void): Spinner {
  const frames = isUnicode() ? UNICODE_FRAMES : ASCII_FRAMES
  let activeLabel: string | undefined
  let frameIndex = 0
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let visible = false

  const draw = (): void => {
    if (activeLabel === undefined) {
      return
    }

    // A label wider than the row wraps, and `\r` rewinds only the last physical row, so every
    // later frame would print below the one before it and stack copies down the screen.
    const label = truncate(activeLabel, terminalWidth() - LABEL_RESERVED_COLUMNS)

    write(`\r${frames[frameIndex++ % frames.length]} ${label}${ERASE_TO_END}`)
  }

  const reveal = (): void => {
    revealTimer = undefined
    visible = true
    draw()
    timer = setInterval(draw, SPINNER_INTERVAL_MS)
    timer.unref()
  }

  return {
    start(nextLabel): void {
      if (!isInteractiveStdout() || activeLabel === nextLabel) {
        return
      }

      activeLabel = nextLabel

      // Already on screen: relabel in place. Still waiting to be revealed: the pending timer
      // paints whichever label is current when it fires.
      if (visible) {
        draw()
        return
      }

      if (revealTimer === undefined) {
        revealTimer = setTimeout(reveal, REVEAL_DELAY_MS)
        revealTimer.unref()
      }
    },

    stop(): void {
      if (revealTimer !== undefined) {
        clearTimeout(revealTimer)
        revealTimer = undefined
      }

      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }

      if (activeLabel === undefined) {
        return
      }

      activeLabel = undefined

      if (visible) {
        visible = false
        write(CLEAR_TRANSIENT_LINE)
      }
    },
  }
}

/** The sibling of `createSpinner` for output that is not a terminal: after the same reveal delay a
 *  changed label becomes its own plain line, at most one per interval. `stop` clears the one
 *  reveal timer. */
export function createLineProgress(writeLine: (line: string) => void): Spinner {
  let activeLabel: string | undefined
  let lastLabel: string | undefined
  let lastAt = Number.NEGATIVE_INFINITY
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let revealed = false

  const emit = (): void => {
    if (activeLabel === undefined || activeLabel === lastLabel) {
      return
    }

    lastLabel = activeLabel
    lastAt = performance.now()
    writeLine(activeLabel)
  }

  const reveal = (): void => {
    revealTimer = undefined
    revealed = true
    emit()
  }

  return {
    start(label): void {
      if (isQuiet()) {
        return
      }

      activeLabel = label

      if (revealed) {
        if (performance.now() - lastAt >= LINE_PROGRESS_INTERVAL_MS) {
          emit()
        }

        return
      }

      if (revealTimer === undefined) {
        revealTimer = setTimeout(reveal, REVEAL_DELAY_MS)
        revealTimer.unref()
      }
    },

    stop(): void {
      if (revealTimer !== undefined) {
        clearTimeout(revealTimer)
        revealTimer = undefined
      }

      activeLabel = undefined
      lastLabel = undefined
      revealed = false
    },
  }
}
