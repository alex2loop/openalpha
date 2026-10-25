import { type ReadonlySignal, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

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
  useEffect(() => {
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
  }, [])

  return result
}
