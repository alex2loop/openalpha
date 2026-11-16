import type { SourceFetchOutcome } from '@/trading/sources/types'
import { ttlCache } from '@/core/utils/collections'
import { createSharedFlight, type SharedFlight } from '@/trading/kernel/shared-flight'

type CachedRead<K, V> = (key: K, signal: AbortSignal) => Promise<SourceFetchOutcome<V>>

interface CachedReaderOptions<K, V> {
  readonly ttlMs: number
  readonly maxEntries: number
  load(key: K, signal: AbortSignal): Promise<SourceFetchOutcome<V>>
}

interface CachedValue<V> {
  readonly value: V
  readonly fetchedAt: number
}

/** A keyed read held for `ttlMs`. Callers arriving on a cold key share the one load, which an abort
 *  of any single caller does not cancel. Only a successful load is kept, so a failure is asked
 *  again by the next caller; the loads in flight are bounded by the keys asked at once. */
export function createCachedReader<K, V>(options: CachedReaderOptions<K, V>): CachedRead<K, V> {
  const cache = ttlCache<K, CachedValue<V>>(options.ttlMs, options.maxEntries)
  const pending = new Map<K, SharedFlight<SourceFetchOutcome<V>>>()

  async function load(key: K, signal: AbortSignal): Promise<SourceFetchOutcome<V>> {
    const outcome = await options.load(key, signal)

    if (outcome.kind === 'ok') {
      cache.set(key, { value: outcome.value, fetchedAt: outcome.fetchedAt })
    }

    return outcome
  }

  return (key, signal) => {
    const held = cache.get(key)

    if (held !== undefined) {
      return Promise.resolve({ kind: 'ok', value: held.value, fetchedAt: held.fetchedAt })
    }

    let flight = pending.get(key)

    if (flight?.live !== true) {
      const started = createSharedFlight((shared) => load(key, shared))
      const release = (): void => {
        if (pending.get(key) === started) {
          pending.delete(key)
        }
      }

      flight = started
      pending.set(key, started)
      started.work.then(release, release)
    }

    return flight.attach(signal)
  }
}
