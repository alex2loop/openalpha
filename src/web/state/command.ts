import { signal } from '@preact/signals'

import { selectAgent } from '@/web/state/agents'
import { sendMessage } from '@/web/state/chat'

const HISTORY_MAX = 50

export const SUGGEST_COMMAND = '/suggest'
export const ALERT_CREATE_COMMAND = '/alert create'
export const WATCHLIST_ADD_COMMAND = '/watchlist add'

// What the operator sent, oldest first.
const sent = signal<readonly string[]>([])
// Where up and down stand in `sent`, counted from the newest; absent while the operator types.
let recallIndex: number | undefined
let inputElement: HTMLInputElement | undefined

/** What the command box holds. */
export const inputText = signal('')
/** The last send found the socket down; cleared by typing or the next send. */
export const isNotSent = signal(false)

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
 *  agent before. Offline, `isNotSent` says so and an empty box takes the command. */
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
    isNotSent.value = true
    holdUnsent(text)
  }
}

export function focusInput(): void {
  inputElement?.focus()
}

/** The operator typed: any recall ends there. */
export function setInput(text: string): void {
  inputText.value = text
  isNotSent.value = false
  recallIndex = undefined
}

/** Sends the box; offline, the text stays and `isNotSent` says why. */
export function sendFromInput(): void {
  const text = inputText.value.trim()

  if (text !== '' && send(text)) {
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
    isNotSent.value = true
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
