import { signal } from '@preact/signals'
import { useLayoutEffect } from 'preact/hooks'

import { toErrorText, tr } from '@/web/text/tr'

import './undo-bar.css'

const UNDO_MS = 8_000

interface UndoEntry {
  readonly text: string
  readonly undo: () => Promise<string | undefined>
  readonly failure?: string
  readonly isBusy?: true
}

// One at a time: a new removal replaces the bar and its timer.
const current = signal<UndoEntry | undefined>(undefined)
let timer: ReturnType<typeof setTimeout> | undefined

/** Says what was just removed and offers to put it back for `UNDO_MS`. `undo` is the inverse call,
 *  a fresh request: it throws `ApiFailure` when it fails and resolves with the daemon's refusal in
 *  words when it put nothing back; the bar then stays with that sentence. */
export function showUndo(text: string, undo: () => Promise<string | undefined>): void {
  current.value = { text, undo }
  armTimer()
}

/** Mounted once, above the panel's view; leaving the page clears its timer. */
export function UndoBar() {
  useLayoutEffect(() => dismiss, [])

  const entry = current.value

  if (entry === undefined) {
    return null
  }

  return (
    <div class="undo-bar" role="status">
      <span>{entry.failure ?? entry.text}</span>
      <button type="button" class="link" disabled={entry.isBusy} onClick={() => runUndo(entry)}>
        {tr('ui.office.common.undo')}
      </button>
    </div>
  )
}

function armTimer(): void {
  clearTimeout(timer)
  timer = setTimeout(dismiss, UNDO_MS)
}

function dismiss(): void {
  clearTimeout(timer)
  timer = undefined
  current.value = undefined
}

function runUndo(entry: UndoEntry): void {
  if (entry.isBusy === true) {
    return
  }

  const busy: UndoEntry = { text: entry.text, undo: entry.undo, isBusy: true }

  // The bar stays while the call runs, however long it takes.
  clearTimeout(timer)
  current.value = busy
  entry.undo().then(
    (refusal) => settle(busy, refusal),
    (error: unknown) => settle(busy, toErrorText(error))
  )
}

// A newer removal may have replaced the bar while the call ran; it is not ours to close or rewrite.
function settle(busy: UndoEntry, failure: string | undefined): void {
  if (current.value !== busy) {
    return
  }

  if (failure === undefined) {
    dismiss()
    return
  }

  current.value = { text: busy.text, undo: busy.undo, failure }
  armTimer()
}
