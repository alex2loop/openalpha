import { type ReadonlySignal, signal } from '@preact/signals'

import { showPane } from '@/web/state/pane'

/** A request to show a run in the office; `seq` tells two requests for one run apart. */
interface FocusRequest {
  readonly runId: string
  readonly seq: number
}

const request = signal<FocusRequest | undefined>(undefined)
let requestSeq = 0

/** The latest "show me" request, handed over once: the scene answers it by bringing the run's room
 *  into view, and a scene mounted later does not repeat it. Reading it subscribes the caller. */
export function takeFocusRequest(): FocusRequest | undefined {
  const held = request.value

  request.value = undefined

  return held
}

export function focusRun(runId: string): void {
  showPane('office')
  requestSeq++
  request.value = { runId, seq: requestSeq }
}

const selected = signal<string | undefined>(undefined)

/** The person the operator is looking at in the office: the actor of the run asked for. */
export const selectedActor: ReadonlySignal<string | undefined> = selected

export function selectActor(id: string | undefined): void {
  selected.value = id
}
