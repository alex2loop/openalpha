import { signal } from '@preact/signals'
import { useEffect, useLayoutEffect } from 'preact/hooks'

import { toErrorText, tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'

import './undo-bar.css'

const UNDO_MS = 8_000
const VISIBLE = 'visible'

/** Either the inverse call, made when the operator presses Undo, or the call itself, held back until
 *  the bar ends (its time runs out or another removal replaces it) and sent at most once. Each call
 *  resolves with the daemon's refusal in words when it did nothing and throws `ApiFailure` when it
 *  failed. A held call puts back what the page hid with `restore` on Undo, or when the bar is
 *  dropped before its time ran out (a sign-out), and with `onRefused` when it is refused. */
type UndoAction =
  | { readonly undo: () => Promise<string | undefined> }
  | {
      readonly commit: () => Promise<string | undefined>
      readonly restore: () => void
      readonly onRefused: () => void
    }

type CommitAction = Extract<UndoAction, { readonly commit: unknown }>

interface UndoEntry {
  readonly text: string
  readonly action: UndoAction
  readonly failure?: string
  readonly isBusy?: true
}

// One at a time: a new removal replaces the bar, and a held call it replaces is sent first.
const current = signal<UndoEntry | undefined>(undefined)
// Every held call already sent, restored or dropped, so none is ever sent twice.
const settled = new WeakSet<CommitAction>()

/** Says what was just removed and offers to put it back for `UNDO_MS` of the page in view. */
export function showUndo(text: string, action: UndoAction): void {
  const held = current.value

  current.value = { text, action }

  if (held !== undefined && isHeldCommit(held)) {
    runCommit(held.text, held.action)
  }
}

/** Mounted once by the shell. Its time runs only while it is mounted and the page is in view; when
 *  it leaves (a sign-out) a held call is dropped, never sent. */
export function UndoBar() {
  const entry = current.value

  useLayoutEffect(() => dropHeld, [])
  useEffect(
    () => (entry === undefined || entry.isBusy === true ? undefined : armWindow(entry)),
    [entry]
  )

  if (entry === undefined) {
    return null
  }

  const canUndo = 'undo' in entry.action || isHeldCommit(entry)

  return (
    <div class="undo-bar glass is-strong" role="status">
      <span>{entry.failure ?? entry.text}</span>
      {canUndo && (
        <Button kind="tertiary" disabled={entry.isBusy === true} onClick={() => press(entry)}>
          {tr('ui.office.common.undo')}
        </Button>
      )}
    </div>
  )
}

// The bar leaves before its time ran out: a held call is not sent, and what it hid comes back.
function dropHeld(): void {
  const held = current.value

  current.value = undefined

  if (held !== undefined && isHeldCommit(held)) {
    restore(held.action)
  }
}

// Counts down only while the page is visible; the returned stop clears the timer and the listener.
function armWindow(entry: UndoEntry): () => void {
  const listeners = new AbortController()
  let remainingMs = UNDO_MS
  let startedAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const resume = (): void => {
    if (timer !== undefined) {
      return
    }

    startedAt = performance.now()
    timer = setTimeout(() => endWindow(entry), remainingMs)
  }
  const pause = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
      remainingMs -= performance.now() - startedAt
    }
  }

  if (document.visibilityState === VISIBLE) {
    resume()
  }

  document.addEventListener(
    'visibilitychange',
    () => (document.visibilityState === VISIBLE ? resume() : pause()),
    { signal: listeners.signal }
  )

  return () => {
    clearTimeout(timer)
    listeners.abort()
  }
}

function endWindow(entry: UndoEntry): void {
  if (current.value !== entry) {
    return
  }

  current.value = undefined

  if (isHeldCommit(entry)) {
    runCommit(entry.text, entry.action)
  }
}

function isHeldCommit(entry: UndoEntry): entry is UndoEntry & { readonly action: CommitAction } {
  return 'commit' in entry.action && !settled.has(entry.action)
}

function press(entry: UndoEntry): void {
  if ('commit' in entry.action) {
    current.value = undefined
    restore(entry.action)
    return
  }

  runUndo(entry.text, entry.action.undo)
}

function restore(action: CommitAction): void {
  if (!settled.has(action)) {
    settled.add(action)
    action.restore()
  }
}

// A refusal puts the row back and shows its sentence alone, only where no newer bar took the place.
function runCommit(text: string, action: CommitAction): void {
  if (settled.has(action)) {
    return
  }

  settled.add(action)

  const refuse = (failure: string): void => {
    action.onRefused()

    if (current.value === undefined) {
      current.value = { text, action, failure }
    }
  }

  action.commit().then(
    (refusal) => (refusal === undefined ? undefined : refuse(refusal)),
    (error: unknown) => refuse(toErrorText(error))
  )
}

function runUndo(text: string, undo: () => Promise<string | undefined>): void {
  const busy: UndoEntry = { text, action: { undo }, isBusy: true }

  // The bar stays while the call runs, however long it takes.
  current.value = busy
  undo().then(
    (refusal) => settleUndo(busy, refusal),
    (error: unknown) => settleUndo(busy, toErrorText(error))
  )
}

// A newer removal may have replaced the bar while the call ran; it is not ours to close or rewrite.
function settleUndo(busy: UndoEntry, failure: string | undefined): void {
  if (current.value !== busy) {
    return
  }

  current.value =
    failure === undefined ? undefined : { text: busy.text, action: busy.action, failure }
}
