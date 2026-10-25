import { type ReadonlySignal, signal } from '@preact/signals'

/** A request to show a run in the office; `seq` tells two requests for one run apart. */
interface FocusRequest {
  readonly runId: string
  readonly seq: number
}

const request = signal<FocusRequest | undefined>(undefined)
let requestSeq = 0

/** The latest "show me" request; the scene answers it by bringing the run's room into view. */
export const focusRequest: ReadonlySignal<FocusRequest | undefined> = request

export function focusRun(runId: string): void {
  requestSeq++
  request.value = { runId, seq: requestSeq }
}

const selected = signal<string | undefined>(undefined)

/** The person the operator is looking at in the office: the actor of the run asked for. */
export const selectedActor: ReadonlySignal<string | undefined> = selected

export function selectActor(id: string | undefined): void {
  selected.value = id
}
