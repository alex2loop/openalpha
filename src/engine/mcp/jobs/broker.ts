import { randomUUID } from 'node:crypto'

import type {
  ClientModelAnswer,
  ClientModelBroker,
  ClientModelRequest,
  ClientModelRequestDraft,
} from '@/ai/api'
import { abortError, LLMError } from '@/core/errors'

/** A runaway producer's ceiling, and so the most answers one batch can carry; a real debate round
 *  parks at most three. */
export const MAX_PENDING_REQUESTS = 32

type AnswerOutcome = 'accepted' | 'not_pending'

interface ParkedRequest extends PendingRequest {
  resolve(answer: ClientModelAnswer): void
  reject(reason: Error): void
  detach(): void
}

interface JobSlot {
  readonly parked: Map<string, ParkedRequest>
  readonly onPending: () => void
}

export interface PendingRequest {
  readonly request: ClientModelRequest
  /** `performance.now()` when it was posted. */
  readonly postedAt: number
}

export interface RequestBroker extends ClientModelBroker {
  open(jobId: string, onPending: () => void): void
  pending(jobId: string): readonly ClientModelRequest[]
  request(jobId: string, requestId: string): PendingRequest | undefined
  /** `performance.now()` when the longest-waiting request was posted; undefined when none is. */
  oldestPendingAt(jobId: string): number | undefined
  answer(jobId: string, requestId: string, answer: ClientModelAnswer): AnswerOutcome
  close(jobId: string, reason: Error): void
}

/** A parked request leaves by exactly one path - answered, aborted, or rejected when its job
 *  closes - and each path detaches its abort listener. */
export function createRequestBroker(): RequestBroker {
  const slots = new Map<string, JobSlot>()

  return {
    open(jobId, onPending) {
      slots.set(jobId, { parked: new Map(), onPending })
    },
    post: (jobId, draft, signal) => park(slots.get(jobId), draft, signal),
    pending: (jobId) => [...(slots.get(jobId)?.parked.values() ?? [])].map((p) => p.request),
    request: (jobId, requestId) => slots.get(jobId)?.parked.get(requestId),
    // A Map iterates in insertion order, so the first entry is the oldest.
    oldestPendingAt: (jobId) => slots.get(jobId)?.parked.values().next().value?.postedAt,
    answer(jobId, requestId, answer): AnswerOutcome {
      const parked = takeParked(slots.get(jobId), requestId)

      if (parked === undefined) {
        return 'not_pending'
      }

      parked.resolve(answer)

      return 'accepted'
    },
    close(jobId, reason) {
      const slot = slots.get(jobId)

      if (slot === undefined) {
        return
      }

      slots.delete(jobId)

      for (const requestId of [...slot.parked.keys()]) {
        takeParked(slot, requestId)?.reject(reason)
      }
    },
  }
}

function park(
  slot: JobSlot | undefined,
  draft: ClientModelRequestDraft,
  signal: AbortSignal
): Promise<ClientModelAnswer> {
  if (signal.aborted) {
    return Promise.reject(abortError(signal))
  }

  if (slot === undefined) {
    return Promise.reject(new LLMError('fatal', 'no open mcp job for this client model request'))
  }

  if (slot.parked.size >= MAX_PENDING_REQUESTS) {
    return Promise.reject(
      new LLMError('fatal', `an mcp job holds at most ${MAX_PENDING_REQUESTS} pending requests`)
    )
  }

  const request: ClientModelRequest = { ...draft, id: randomUUID() }

  return new Promise((resolve, reject) => {
    const onAbort = (): void => takeParked(slot, request.id)?.reject(abortError(signal))

    signal.addEventListener('abort', onAbort, { once: true })
    slot.parked.set(request.id, {
      request,
      postedAt: performance.now(),
      resolve,
      reject,
      detach: () => signal.removeEventListener('abort', onAbort),
    })
    slot.onPending()
  })
}

function takeParked(slot: JobSlot | undefined, requestId: string): ParkedRequest | undefined {
  const parked = slot?.parked.get(requestId)

  if (slot === undefined || parked === undefined) {
    return undefined
  }

  slot.parked.delete(requestId)
  parked.detach()

  return parked
}
