import { type ReadonlySignal, type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import { ApiFailure } from '@/web/api/client'

export type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'failed'; readonly failure: ApiFailure }

/** Runs `load` once on mount and aborts it on unmount, so a popover's read stops when it closes. */
export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>
): ReadonlySignal<LoadState<T>> {
  const result = useSignal<LoadState<T>>({ status: 'loading' })

  // One read per mount, by design: `load` is not a dependency.
  useEffect(() => startLoad(load, result), [])

  return result
}

/** As `useLoad`, but the read starts at the first `request()`: a fold reads nothing until opened.
 *  The read ends with the component. */
export function useLazyLoad<T>(load: (signal: AbortSignal) => Promise<T>): {
  readonly result: ReadonlySignal<LoadState<T>>
  readonly request: () => void
} {
  const result = useSignal<LoadState<T>>({ status: 'loading' })
  const stop = useRef<(() => void) | undefined>(undefined)

  useEffect(() => () => stop.current?.(), [])

  function request(): void {
    stop.current ??= startLoad(load, result)
  }

  return { result, request }
}

// Starts the read and returns what aborts it.
function startLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  result: Signal<LoadState<T>>
): () => void {
  const controller = new AbortController()

  load(controller.signal).then(
    (value) => {
      result.value = { status: 'ready', value }
    },
    (error: unknown) => {
      // Anything but an `ApiFailure` is this unmount's own abort.
      if (error instanceof ApiFailure) {
        result.value = { status: 'failed', failure: error }
      }
    }
  )

  return () => controller.abort()
}
