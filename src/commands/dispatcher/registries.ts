// Lifetime of the dispatcher's three admission registries: cooldown deadlines, idempotency stamps,
// and per-identity call windows. The dispatcher itself owns admission policy.
//
// Not `ttlCache`: that expires lazily on read, so a key nobody looks up again is never released.
// Admission keys are per-identity and mostly never revisited, so expiry has to be swept eagerly —
// batched so one sweep cannot stall a dispatch, with a hard cap as the backstop.

export const RATE_WINDOW_MS = 60_000
export const IDEMPOTENCY_TTL_MS = 5 * 60_000

const SWEEP_BATCH_SIZE = 64
const MAX_ADMISSION_KEYS = 10_000

interface AdmissionRegistries {
  readonly cooldowns: Map<string, number>
  readonly idempotency: Map<string, number>
  readonly calls: Map<string, readonly number[]>
  readonly now: number
}

export function sweepRegistries(options: AdmissionRegistries): void {
  sweepTimestamps(options.cooldowns, options.now, 0)
  sweepTimestamps(options.idempotency, options.now, IDEMPOTENCY_TTL_MS)
  sweepCalls(options.calls, options.now)

  capRegistry(options.cooldowns)
  capRegistry(options.idempotency)
  capRegistry(options.calls)
}

function sweepTimestamps(registry: Map<string, number>, now: number, ttlMs: number): void {
  let removed = 0
  for (const [key, ts] of registry) {
    if (ts + ttlMs <= now) {
      registry.delete(key)
      removed += 1
      if (removed >= SWEEP_BATCH_SIZE) {
        break
      }
    }
  }
}

function sweepCalls(calls: Map<string, readonly number[]>, now: number): void {
  let removed = 0
  for (const [key, stamps] of calls) {
    const active = stamps.filter((at) => now - at < RATE_WINDOW_MS)
    if (active.length === 0) {
      calls.delete(key)
      removed += 1
      if (removed >= SWEEP_BATCH_SIZE) {
        break
      }
    } else if (active.length !== stamps.length) {
      calls.set(key, active)
    }
  }
}

// The batched TTL sweep only runs on a later command, so a burst followed by idle time leaves stale
// keys resident. This is the ceiling: oldest insertion goes first, and an evicted key re-admits.
function capRegistry<V>(registry: Map<string, V>): void {
  for (const key of registry.keys()) {
    if (registry.size <= MAX_ADMISSION_KEYS) {
      return
    }

    registry.delete(key)
  }
}
