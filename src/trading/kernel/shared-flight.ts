import { abortError } from '@/core/errors'

export interface SharedFlight<T> {
  readonly work: Promise<T>
  /** False once every caller gave up: the run is winding down and cannot answer a new one. */
  readonly live: boolean
  attach(signal: AbortSignal): Promise<T>
}

/** One run several callers wait on. It runs under a signal owned here, aborted only once every
 *  attached caller has aborted, so the caller that happened to start it cancelling never fails the
 *  ones still waiting. A caller's own abort detaches that caller alone. */
export function createSharedFlight<T>(run: (signal: AbortSignal) => Promise<T>): SharedFlight<T> {
  const controller = new AbortController()
  const work = run(controller.signal)
  let attached = 0

  const abandonIfUnattended = (signal: AbortSignal): void => {
    if (attached === 0) {
      controller.abort(signal.reason)
    }
  }

  return {
    work,
    get live(): boolean {
      return !controller.signal.aborted
    },
    attach(signal): Promise<T> {
      if (signal.aborted) {
        abandonIfUnattended(signal)

        return Promise.reject(abortError(signal))
      }

      attached += 1

      return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => {
          attached -= 1
          abandonIfUnattended(signal)
          reject(abortError(signal))
        }

        signal.addEventListener('abort', onAbort, { once: true })
        work.then(
          (value) => {
            signal.removeEventListener('abort', onAbort)
            resolve(value)
          },
          (err: unknown) => {
            signal.removeEventListener('abort', onAbort)
            reject(err)
          }
        )
      })
    },
  }
}
