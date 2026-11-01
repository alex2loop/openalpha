import type { SourceContext, SourceKind } from '@/trading/kernel/source/source-result'
import type { SourceRequest } from '@/trading/sources/types'

export interface RequestCoalescer {
  share<T>(key: string, signal: AbortSignal, run: () => Promise<T>): Promise<T>
}

interface Flight {
  readonly signal: AbortSignal
  readonly pass: Promise<unknown>
}

/** Merges the requests one operation has in flight at the same instant, and nothing else. The entry
 *  is dropped the moment it settles, so no caller is answered from an earlier read and the map
 *  cannot outgrow what is currently running. Five portfolio candidates scored together each asked
 *  for the same market-wide board, which the provider counted five times.
 *
 *  Sharing requires the same signal, because the joined request runs under the signal of whoever
 *  arrived first: one run cancelling must never fail a read another run is waiting on. Every caller
 *  within an operation threads one signal, which is exactly the scope worth merging. */
export function createRequestCoalescer(): RequestCoalescer {
  const inFlight = new Map<string, Flight>()

  return {
    share<T>(key: string, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
      const joined = inFlight.get(key)

      if (joined !== undefined && joined.signal === signal) {
        // why-safe: the key names the request, and one request settles to one result type.
        return joined.pass as Promise<T>
      }

      const pass = run().finally(() => {
        if (inFlight.get(key)?.pass === pass) {
          inFlight.delete(key)
        }
      })

      inFlight.set(key, { signal, pass })

      return pass
    },
  }
}

/** Every field the answer can vary by, ordered so two call sites that build the same request in a
 *  different key order still share one read. Derived rather than enumerated: a field added to
 *  `SourceContext` joins the key on its own, where a fixed list would silently let two unlike
 *  requests share an answer. */
export function sourceRequestKey(kind: SourceKind, context: SourceContext): string {
  const fields = Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${valueKey(value)}`)

  return `${kind}|${fields.join('&')}`
}

/** What the provider is actually asked, so a lookup whose request ignores its symbol — several
 *  return the whole board however few rows the caller wants — shares one download across the
 *  symbols resolving together, while a lookup that does vary by symbol keeps its own key. */
export function providerRequestKey(request: SourceRequest): string {
  return `${request.sourceId}|${request.path}|${valueKey(request.query ?? {})}`
}

// Strings and lists are quoted, so a separator inside a value (`['a,b']` against `['a', 'b']`, or an
// `&` in a search subject) can never make two unlike requests share one key.
function valueKey(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(valueKey))
  }

  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value, Object.keys(value).sort())
  }

  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}
