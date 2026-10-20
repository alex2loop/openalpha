import type { SourceHealthLog } from '@/trading/sources/transport/health'
import type { Pacer } from '@/trading/sources/transport/pacer'
import type { SourceFetchOutcome, SourceRequest } from '@/trading/sources/types'
import { abortError } from '@/core/errors'

interface Admission {
  readonly health: SourceHealthLog
  readonly pacer: Pacer
}

/** An error outcome when the request must not be sent, `null` to proceed. Paced before the call
 *  rather than after a 429, and the breaker is read on both sides of the wait. */
export async function admitRequest(
  admission: Admission,
  request: SourceRequest,
  budget: AbortSignal
): Promise<SourceFetchOutcome<never> | null> {
  const blocked = guardRequest(admission, request)

  if (blocked) {
    return blocked
  }

  if ((await admission.pacer.acquire(request.sourceId, budget)) === 'aborted') {
    return queueExpiredOutcome(request)
  }

  return guardRequest(admission, request)
}

// Abort still throws: it is the caller's cancellation, not a fetch outcome.
function guardRequest(
  admission: Admission,
  request: SourceRequest
): SourceFetchOutcome<never> | null {
  if (request.signal.aborted) {
    throw abortError(request.signal)
  }

  if (admission.health.isOnCooldown(request.sourceId)) {
    return { kind: 'error', code: 'source.breaker-open' }
  }

  return null
}

/** Nothing was sent: the budget ran out while the call queued behind the pacer, which says nothing
 *  about the provider, so the breaker is not told. */
function queueExpiredOutcome(request: SourceRequest): SourceFetchOutcome<never> {
  if (request.signal.aborted) {
    throw abortError(request.signal)
  }

  return { kind: 'error', code: 'source.timeout' }
}
