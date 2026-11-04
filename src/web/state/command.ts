import { signal } from '@preact/signals'

import { selectAgent } from '@/web/state/agents'
import { COMMAND_PREFIX, isFinished, sendMessage, thread } from '@/web/state/chat'
import { isAnalysisOnly } from '@/web/state/edition'
import { isCommandRun, runs } from '@/web/state/live'
import { quietCommands } from '@/web/state/quiet-command'

const HISTORY_MAX = 50
// A key is a long run of letters and digits, so a typed line holding one is refused on the web
// edition: it would go to the worker, the transcript and the model as plain text.
const KEY_LIKE_MIN_LENGTH = 32
const KEY_LIKE_RUN_RE = new RegExp(`[A-Za-z0-9_-]{${KEY_LIKE_MIN_LENGTH},}`, 'g')
const LETTER_RE = /[A-Za-z]/
const DIGIT_RE = /\d/
// A ledger row's full id is a UUID, which a `/update` or `/delete` line may carry.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const SUGGEST_COMMAND = '/suggest'
// A command's run is named without the slash.
export const BRIEF_NAME = 'brief'
export const BRIEF_COMMAND = `${COMMAND_PREFIX}${BRIEF_NAME}`
// `/suggest`'s word for a fresh run past a call it would otherwise hand back.
export const FORCE_ARG = 'force'
// `/suggest`'s word for a pass over every held name, not one.
export const SUGGEST_STOPS_ARG = 'stops'
export const ALERT_CREATE_COMMAND = '/alert create'
export const WATCHLIST_ADD_COMMAND = '/watchlist add'

// What the operator sent, oldest first.
const sent = signal<readonly string[]>([])
// Where up and down stand in `sent`, counted from the newest; absent while the operator types.
let recallIndex: number | undefined
let inputElement: HTMLInputElement | undefined

/** What the command box holds. */
export const inputText = signal('')
/** Why the last send did not go: the socket was down, or the line held a key. Cleared by typing or
 *  the next send. */
export const notSent = signal<'offline' | 'key-like' | undefined>(undefined)

/** The command bar registers its input; the returned function releases it. */
export function registerInput(element: HTMLInputElement): () => void {
  inputElement = element

  return () => {
    if (inputElement === element) {
      inputElement = undefined
    }
  }
}

/** Puts `text` in the box for the operator to send; never sends it. */
export function fillInput(text: string, opts: { readonly agentId?: string } = {}): void {
  if (opts.agentId !== undefined) {
    selectAgent(opts.agentId)
  }

  setInput(text)
  focusInput()
}

/** Sends a button's own command, leaving what is typed in the box alone. A named agent is switched
 *  to first, and the command goes once the daemon confirmed the switch, so it is never asked of the
 *  agent before. Offline, `notSent` says so and an empty box takes the command. */
export function runCommand(text: string, opts: { readonly agentId?: string } = {}): void {
  const run = (): void => {
    if (!send(text)) {
      holdUnsent(text)
    }
  }

  if (opts.agentId === undefined) {
    run()
    return
  }

  if (!selectAgent(opts.agentId, run)) {
    notSent.value = 'offline'
    holdUnsent(text)
  }
}

/** A button's command is still on its way or running, in the chat or sent quiet, so pressing it
 *  again would only queue a second run. A bare command runs once at a time wherever it was asked,
 *  so a run of it from another channel holds the button too. */
export function isRunningCommand(text: string): boolean {
  return (
    quietCommands.value.includes(text) ||
    thread.value.some((turn) => turn.text === text && !isFinished(turn)) ||
    runs.value.some((run) => isCommandRun(run, text.slice(COMMAND_PREFIX.length)))
  )
}

export function focusInput(): void {
  inputElement?.focus()
}

/** The operator typed: any recall ends there. */
export function setInput(text: string): void {
  inputText.value = text
  notSent.value = undefined
  recallIndex = undefined
}

/** Sends the box; offline, or with a key in the line on the web edition, the text stays and
 *  `notSent` says why. */
export function sendFromInput(): void {
  const text = inputText.value.trim()

  if (text === '') {
    return
  }

  if (isAnalysisOnly.value && hasKeyLikeToken(text)) {
    notSent.value = 'key-like'
    return
  }

  if (send(text)) {
    setInput('')
  }
}

/** True while up and down walk the history: the box is empty or holds a recalled line. */
export function isRecalling(): boolean {
  return inputText.value === '' || recallIndex !== undefined
}

/** Steps back (`older`) or forward through what was sent; past the newest the box empties. */
export function recall(direction: 'older' | 'newer'): void {
  const count = sent.value.length
  const index = direction === 'older' ? (recallIndex ?? -1) + 1 : (recallIndex ?? 0) - 1

  if (count === 0 || index >= count) {
    return
  }

  if (index < 0) {
    setInput('')
    return
  }

  inputText.value = sent.value[count - 1 - index] ?? ''
  recallIndex = index
}

// What was sent joins the recall history; a refused send marks the box not sent.
function send(text: string): boolean {
  if (!sendMessage(text)) {
    notSent.value = 'offline'
    return false
  }

  sent.value = [...sent.value.filter((held) => held !== text), text].slice(-HISTORY_MAX)

  return true
}

// A draft the operator typed outranks a button's command.
function holdUnsent(text: string): void {
  if (inputText.value.trim() === '') {
    inputText.value = text
  }
}

function hasKeyLikeToken(text: string): boolean {
  return (text.match(KEY_LIKE_RUN_RE) ?? []).some(isKeyLike)
}

// A key mixes letters and digits; a long word, a number or a UUID does not count.
function isKeyLike(run: string): boolean {
  return LETTER_RE.test(run) && DIGIT_RE.test(run) && !UUID_RE.test(run)
}
