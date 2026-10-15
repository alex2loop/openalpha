import type { ResearchProviderFailureCode } from '@/engine/api'

// Only a provider's own misbehaviour opens the circuit. An abort is the caller's decision and an
// authentication or invalid-request failure is ours to fix, so neither indicts the provider.
const BREAKER_FAILURE_CODES: ReadonlySet<ResearchProviderFailureCode> = new Set([
  'rate_limited',
  'timeout',
  'transport',
  'invalid_response',
])

export interface ProviderBreaker {
  isOpen(provider: string, now: number): boolean
  recordSuccess(provider: string): void
  recordFailure(provider: string, code: ResearchProviderFailureCode, now: number): void
}

interface BreakerEntry {
  failures: number
  openedAt?: number
}

interface ProviderBreakerInput {
  readonly threshold: number
  readonly cooldownMs: number
}

/**
 * Skips a provider that keeps failing, so a dead one costs one batch of timeouts instead of one per
 * question. `now` readings are `performance.now()`: the cooldown measures elapsed time.
 */
export function createProviderBreaker(input: ProviderBreakerInput): ProviderBreaker {
  const { threshold, cooldownMs } = input
  // Keyed by provider name, a closed set fixed at boot, so the map needs no eviction bound.
  const entries = new Map<string, BreakerEntry>()

  return {
    isOpen(provider, now): boolean {
      const entry = entries.get(provider)
      if (entry?.openedAt === undefined) {
        return false
      }

      if (now - entry.openedAt < cooldownMs) {
        return true
      }

      // No half-open probe: concurrent questions would all pass one, and gating it behind a flag
      // leaves the breaker stuck open when the probe aborts. A still-dead provider re-opens after
      // another threshold of failures, which is what the threshold is for.
      entries.delete(provider)
      return false
    },

    recordSuccess(provider): void {
      entries.delete(provider)
    },

    recordFailure(provider, code, now): void {
      if (!BREAKER_FAILURE_CODES.has(code)) {
        return
      }

      const entry = entries.get(provider) ?? { failures: 0 }
      entry.failures += 1
      if (entry.failures >= threshold) {
        entry.openedAt = now
      }

      entries.set(provider, entry)
    },
  }
}
