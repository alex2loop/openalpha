export interface CooldownTracker {
  isOnCooldown(id: string): boolean
  readyInMs(id: string): number
  recordSuccess(id: string): void
  recordFailure(id: string, retryAfterMs?: number): void
  pickFallback(ids: readonly string[]): string | undefined
}

export function withCooldown(
  cooldownMs: number,
  now: () => number = () => performance.now()
): CooldownTracker {
  // Unbounded by design: ids name configured providers and their models — boot-time, fixed
  // cardinality.
  const failures = new Map<string, number>()
  const isOnCooldown = (id: string): boolean => {
    const at = failures.get(id)

    return at !== undefined && now() < at
  }

  return {
    isOnCooldown,
    readyInMs(id: string): number {
      const at = failures.get(id)
      return at === undefined ? 0 : Math.max(0, at - now())
    },
    recordSuccess(id: string): void {
      failures.delete(id)
    },
    recordFailure(id: string, retryAfterMs?: number): void {
      const until = now() + (retryAfterMs ?? cooldownMs)

      failures.set(id, Math.max(until, failures.get(id) ?? until))
    },
    pickFallback(ids: readonly string[]): string | undefined {
      return ids.find((id) => !isOnCooldown(id))
    },
  }
}

interface Flight<T> {
  readonly key: string
  readonly signal: AbortSignal
  readonly pass: Promise<T>
  settled: boolean
}

interface FlightCache<T> {
  share(key: string, signal: AbortSignal, run: () => Promise<T>): Promise<T>
  clear(): void
}

/** One pass per key: callers arriving while it runs join it instead of starting a second, and its
 *  settled value answers later callers until the slot is evicted. Sharing a pass still in flight
 *  requires the same signal, because it runs under whoever arrived first — one caller cancelling
 *  must never fail a read another is waiting on. A rejected pass, one whose own caller aborted
 *  before it landed, or one whose value `keep` refuses drops itself rather than becoming a later
 *  caller's answer; callers that joined it in flight still get that value. Bounded to `slots`,
 *  oldest evicted first, so nothing needs a sweep.
 */
export function flightCache<T>(slots: number, keep?: (value: T) => boolean): FlightCache<T> {
  let flights: readonly Flight<T>[] = []

  // Only the entry this pass installed is dropped; a newer key may already own its slot.
  const release = (pass: Promise<T>): void => {
    flights = flights.filter((entry) => entry.pass !== pass)
  }

  return {
    share(key, signal, run): Promise<T> {
      const hit = flights.find(
        (entry) => entry.key === key && (entry.settled || entry.signal === signal)
      )

      if (hit !== undefined) {
        return hit.pass
      }

      const flight: Flight<T> = {
        key,
        signal,
        settled: false,
        pass: run().then(
          (value) => {
            if (signal.aborted || (keep !== undefined && !keep(value))) {
              release(flight.pass)
            } else {
              flight.settled = true
            }

            return value
          },
          (err: unknown) => {
            release(flight.pass)
            throw err
          }
        ),
      }

      flights = [...flights, flight].slice(-slots)

      return flight.pass
    },
    clear(): void {
      flights = []
    },
  }
}

// At most `limit` calls in flight, results keep input order, and a rejection propagates once every
// in-flight worker settles. Workers stop pulling new items as soon as one fails.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>
): Promise<readonly R[]> {
  const results = new Array<R>(items.length)
  const width = Math.max(1, Math.min(limit, items.length))
  // Shared iterator as the queue: `next()` is synchronous, so each worker pulls a distinct entry.
  const queue = items.entries()
  let failed = false
  let firstFailure: unknown

  const worker = async (): Promise<void> => {
    while (!failed) {
      const entry = queue.next()

      if (entry.done === true) {
        return
      }

      const [index, item] = entry.value

      try {
        results[index] = await work(item, index)
      } catch (err: unknown) {
        if (!failed) {
          failed = true
          firstFailure = err
        }
      }
    }
  }

  await Promise.all(Array.from({ length: width }, worker))

  if (failed) {
    throw firstFailure
  }

  return results
}

// True when `work` settled inside the budget, resolved or rejected: a rejection is an answer. It
// must never throw, since callers read it to decide whether cleanup still has to run.
export async function settleWithin(work: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })

  try {
    return await Promise.race([
      work.then(
        () => true,
        () => true
      ),
      expired,
    ])
  } finally {
    clearTimeout(timer)
  }
}
