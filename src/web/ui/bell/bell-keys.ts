import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { Decision } from '@/app/server/wire/chat'
import { pending, pendingRequestId } from '@/web/state/live'
import { stepWrapped } from '@/web/ui/kit/step'

/** The answers a key gives; "always" widens a permission and stays a click. */
export type KeyedDecision = Extract<Decision, 'approve' | 'deny'>

/** A key pressed on the chosen request; `seq` tells two presses apart. */
interface KeyedAnswer {
  readonly requestId: string
  readonly decision: KeyedDecision
  readonly seq: number
}

/** The key cap printed on each keyed answer's button. */
export const DECISION_KEYS = Object.freeze({
  approve: 'Y',
  deny: 'N',
} as const satisfies Record<KeyedDecision, string>)

// The requests this page may answer, oldest first, as the bell lists them.
const answerableIds = computed(() =>
  pending.value.flatMap((entry) => {
    const requestId = pendingRequestId(entry)
    const isAnswerable = entry.kind === 'approval' && entry.event.approval?.answerable === true

    return isAnswerable && requestId !== undefined ? [requestId] : []
  })
)
const chosenId = signal<string | undefined>(undefined)
const keyed = signal<KeyedAnswer | undefined>(undefined)
let keyedSeq = 0

/** The request the open bell outlines; none until Up or Down picks one, and none once it leaves. */
export const chosenRequestId: ReadonlySignal<string | undefined> = computed(() => {
  const id = chosenId.value

  return id !== undefined && answerableIds.value.includes(id) ? id : undefined
})
/** The latest Y or N; the chosen card's buttons answer it once. */
export const keyedAnswer: ReadonlySignal<KeyedAnswer | undefined> = keyed

/** Up (-1) or Down (1) moves the outline, wrapping at either end. */
export function stepChosenRequest(step: 1 | -1): void {
  const ids = answerableIds.value

  if (ids.length === 0) {
    return
  }

  chosenId.value = ids[stepWrapped(ids.indexOf(chosenRequestId.value ?? ''), step, ids.length)]
}

/** Only the outlined request takes a key; with none outlined the key does nothing. */
export function pressDecision(decision: KeyedDecision): void {
  const requestId = chosenRequestId.value

  if (requestId !== undefined) {
    keyedSeq++
    keyed.value = { requestId, decision, seq: keyedSeq }
  }
}

/** The bell closed: nothing stays outlined and no press waits. */
export function clearChosenRequest(): void {
  chosenId.value = undefined
  keyed.value = undefined
}
