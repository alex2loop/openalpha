import { isInteractiveStdout, isUnicode, terminalWidth } from '@/cli/env'
import { truncate } from '@/core/utils/text'

const CLEAR_TRANSIENT_LINE = '\r\x1b[K'
const ERASE_TO_END = '\x1b[K'
// A command that answers faster than this never paints a frame, so an instant reply (a usage line,
// a rejected argument) is not preceded by a flash of progress.
const REVEAL_DELAY_MS = 150
export const SPINNER_INTERVAL_MS = 80
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
