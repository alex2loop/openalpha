import { abortError, assertNotAborted } from '@/core/errors'
import { sleep } from '@/core/utils/time'

const SEND_MIN_GAP_MS = 1_000
const SEND_JITTER_MS = 1_000

export interface SendThrottle {
  run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>
  settle(timeoutMs: number): Promise<void>
}

export function createSendThrottle(): SendThrottle {
  let tail: Promise<unknown> = Promise.resolve()
  let lastSendAt = 0

  return {
    run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) {
        return Promise.reject(abortError(signal))
      }

      const run = tail.then(async () => {
        const gap = SEND_MIN_GAP_MS + Math.floor(Math.random() * SEND_JITTER_MS)
        const wait = gap - (performance.now() - lastSendAt)

        assertNotAborted(signal)

        if (wait > 0) {
          await sleep(wait, signal)
        }

        assertNotAborted(signal)
        lastSendAt = performance.now()
        return fn()
      })

      tail = run.catch(() => undefined)
      return run
    },

    async settle(timeoutMs: number): Promise<void> {
      const bail = new AbortController()

      await Promise.race([tail, sleep(timeoutMs, bail.signal)]).catch(() => undefined)
      bail.abort()
    },
  }
}
