import type { Logger } from '@/core/logging/logger'
import type { CaveatCode } from '@/trading/kernel/caveat'
import type { SourceRequest } from '@/trading/sources/types'
import { HttpRequestError } from '@/core/http-client'
import { formatErrForLog } from '@/core/security/credentials'
import { withCooldown } from '@/core/utils/concurrency'

/** One line per provider per failure kind per window. A fan-out fails the same way a hundred times
 *  in a second, and a hundred identical lines bury the one that explains them. */
const FAILURE_LOG_COOLDOWN_MS = 60_000

/** Transient by protocol: a queue that filled, a gateway that was mid-restart. A status outside this
 *  set is the provider's answer, and repeating the call returns it again. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 425, 500, 502, 503, 504])
const RATE_LIMITED_STATUS = 429

// An attempt that spent its own deadline is retried; the budget is what stops the request.
export function isRetryable(err: unknown): boolean {
  if (isTimeoutError(err)) {
    return true
  }

  // An oversized body is the same size on the next attempt.
  if (!(err instanceof HttpRequestError) || err.code === 'payload_too_large') {
    return false
  }

  // A pacer says when to come back; an allowance that is gone says nothing at all, and repeating
  // the call spends more of what ran out — which is how a month's quota goes in an afternoon.
  if (err.status === RATE_LIMITED_STATUS) {
    return err.retryAfter !== undefined
  }

  return err.status === undefined ? true : RETRYABLE_STATUSES.has(err.status)
}

export function toCaveatCode(err: unknown): CaveatCode {
  if (isTimeoutError(err)) {
    return 'source.timeout'
  }

  if (err instanceof HttpRequestError && err.status === RATE_LIMITED_STATUS) {
    return 'source.rate-limited'
  }

  if (err instanceof HttpRequestError) {
    return 'source.unavailable'
  }

  return 'source.payload-rejected'
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError'
}

export interface FailureReporter {
  report(request: SourceRequest, code: CaveatCode, err: unknown): void
}

/** The caveat says a provider could not answer; only the error says whether that was a block page,
 *  a refused connection or a spent deadline. Without it a provider can be dark for a day and leave
 *  nothing behind but a status word. */
export function createFailureReporter(logger: Logger): FailureReporter {
  const reported = withCooldown(FAILURE_LOG_COOLDOWN_MS)

  return {
    report(request, code, err): void {
      const key = `${request.sourceId}:${code}`

      if (reported.isOnCooldown(key)) {
        return
      }

      reported.recordFailure(key)
      logger.warn('trading.source_failed', {
        sourceId: request.sourceId,
        path: request.path,
        code,
        err: formatErrForLog(err),
      })
    },
  }
}
