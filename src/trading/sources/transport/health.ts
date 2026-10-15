import type { Logger } from '@/core/logging/logger'
import type { CaveatCode } from '@/trading/kernel/caveat'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { SourceSummary } from '@/trading/kernel/source/source-result'
import { withCooldown } from '@/core/utils/concurrency'

export interface SourceHealthLog {
  isOnCooldown(sourceId: SourceId): boolean
  recordSuccess(sourceId: SourceId, at: number): void
  /** Opens the breaker once a provider names its own backoff, once it has failed
   *  `failureThreshold` times in a row, or once `failureRate` of its last `failureWindow`
   *  outcomes failed — a fan-out's successes reset the streak, so a half-dead provider would
   *  otherwise never trip. */
  recordFailure(
    sourceId: SourceId,
    failure: { readonly code: CaveatCode; readonly retryAfterMs?: number }
  ): void
  /** When the provider last worked, why it stopped, and whether its breaker is open. Never a URL,
   *  credential, or provider message: a health view is where a leaked key is least noticed. */
  summary(sourceId: SourceId): Omit<SourceSummary, 'kind'>
}

interface SourceHealthEntry {
  readonly lastSuccessAt?: number
  readonly lastFailureCode?: CaveatCode
}

interface SourceHealthInput {
  readonly cooldownMs: number
  readonly failureThreshold: number
  /** Recent outcomes the failure rate is measured over. */
  readonly failureWindow: number
  /** Share of that window that must have failed for the breaker to open. */
  readonly failureRate: number
  readonly logger: Logger
}

interface OutcomeWindow {
  recordOutcome(sourceId: SourceId, failed: boolean): void
  isFailingTooOften(sourceId: SourceId): boolean
  clear(sourceId: SourceId): void
}

// One fixed-length array per configured provider — bounded by construction, so nothing needs
// eviction. The window must be full before the rate can open the breaker — otherwise the first
// two failures of a cold provider read as 100%.
function createOutcomeWindow(options: {
  readonly failureWindow: number
  readonly failureRate: number
}): OutcomeWindow {
  const recent = new Map<SourceId, boolean[]>()

  return {
    recordOutcome(sourceId, failed) {
      const window = recent.get(sourceId) ?? []

      window.push(failed)

      if (window.length > options.failureWindow) {
        window.shift()
      }

      recent.set(sourceId, window)
    },

    isFailingTooOften(sourceId) {
      const window = recent.get(sourceId)

      if (window === undefined || window.length < options.failureWindow) {
        return false
      }

      return window.filter(Boolean).length / window.length >= options.failureRate
    },

    clear(sourceId) {
      recent.delete(sourceId)
    },
  }
}

// One entry per configured provider, so nothing needs eviction. The breaker lives here because
// "is this provider on cooldown" and "why did it stop" are one question.
export function createSourceHealthLog(input: SourceHealthInput): SourceHealthLog {
  const { failureThreshold, logger } = input
  const breaker = withCooldown(input.cooldownMs)
  const entries = new Map<SourceId, SourceHealthEntry>()
  const consecutiveFailures = new Map<SourceId, number>()
  const outcomes = createOutcomeWindow(input)
  // Which outages have been announced, so a recovery line pairs with exactly one opening and a
  // flaky provider does not narrate every success it manages between two failures.
  const announced = new Set<SourceId>()

  return {
    isOnCooldown: (sourceId) => breaker.isOnCooldown(sourceId),

    recordSuccess(sourceId, at) {
      breaker.recordSuccess(sourceId)
      consecutiveFailures.delete(sourceId)
      outcomes.recordOutcome(sourceId, false)
      entries.set(sourceId, { lastSuccessAt: at })

      if (announced.delete(sourceId)) {
        outcomes.clear(sourceId)
        logger.info('trading.source_recovered', { sourceId })
      }
    },

    recordFailure(sourceId, failure) {
      const failures = (consecutiveFailures.get(sourceId) ?? 0) + 1

      consecutiveFailures.set(sourceId, failures)
      outcomes.recordOutcome(sourceId, true)

      if (
        failure.retryAfterMs !== undefined ||
        failures >= failureThreshold ||
        outcomes.isFailingTooOften(sourceId)
      ) {
        breaker.recordFailure(sourceId, failure.retryAfterMs)
      }

      // The transition, not the failure: every request already in flight when the breaker opened
      // reports its own failure afterwards, and one dark provider is one line.
      if (breaker.isOnCooldown(sourceId) && !announced.has(sourceId)) {
        announced.add(sourceId)
        logger.warn('trading.source_breaker_opened', {
          sourceId,
          code: failure.code,
          readyInMs: Math.round(breaker.readyInMs(sourceId)),
        })
      }

      entries.set(sourceId, { ...entries.get(sourceId), lastFailureCode: failure.code })
    },

    summary(sourceId) {
      const entry = entries.get(sourceId)

      return {
        id: sourceId,
        breaker: breaker.isOnCooldown(sourceId) ? 'open' : 'closed',
        ...(entry?.lastSuccessAt === undefined ? {} : { lastSuccessAt: entry.lastSuccessAt }),
        ...(entry?.lastFailureCode === undefined ? {} : { lastFailureCode: entry.lastFailureCode }),
      }
    },
  }
}
