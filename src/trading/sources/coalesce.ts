import type { SourceContext, SourceKind } from '@/trading/kernel/source/source-result'
import type { SourceRequest } from '@/trading/sources/types'
import { abortError } from '@/core/errors'

export interface RequestCoalescer {
  /** `run` receives the shared read's own signal, never a caller's: it aborts only once every
   *  caller still waiting has aborted. */
  share<T>(key: string, signal: AbortSignal, run: (shared: AbortSignal) => Promise<T>): Promise<T>
}

interface Flight {
  readonly key: string
  readonly pass: Promise<unknown>
  readonly controller: AbortController
  waiting: number
}

type Flights = Map<string, Flight>

/** Merges the requests in flight at the same instant, and nothing else. The entry is dropped the
 *  moment it settles, so no caller is answered from an earlier read and the map cannot outgrow what
 *  is currently running. Five portfolio candidates scored together each asked for the same
 *  market-wide board, which the provider counted five times; the US inflation series was fetched
 *  once per market day asking for it.
 *
 *  Callers need not share a signal: the joined read runs under its own, each caller races only its
 *  own abort (that caller alone is rejected), and the read is cancelled once none is left waiting.
 *  One run cancelling therefore never fails a read another run is waiting on. */
export function createRequestCoalescer(): RequestCoalescer {
  const inFlight: Flights = new Map()

  return {
    share<T>(
      key: string,
      signal: AbortSignal,
      run: (shared: AbortSignal) => Promise<T>
    ): Promise<T> {
      if (signal.aborted) {
        return Promise.reject(abortError(signal))
      }

      return joinFlight<T>(inFlight, inFlight.get(key) ?? startFlight(inFlight, key, run), signal)
    },
  }
}

function startFlight(
  inFlight: Flights,
  key: string,
  run: (shared: AbortSignal) => Promise<unknown>
): Flight {
  const controller = new AbortController()
  const pass = run(controller.signal).finally(() => {
    if (inFlight.get(key)?.pass === pass) {
      inFlight.delete(key)
    }
  })
  const flight: Flight = { key, pass, controller, waiting: 0 }

  inFlight.set(key, flight)

  return flight
}

// The listener is removed on every path out, so a long-lived caller signal never accumulates one per
// read it joined. The last caller to leave drops the entry first, so a newcomer starts a fresh read
// rather than joining one that is being cancelled.
function joinFlight<T>(inFlight: Flights, flight: Flight, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const leave = (): void => signal.removeEventListener('abort', onAbort)
    const onAbort = (): void => {
      leave()
      flight.waiting -= 1

      if (flight.waiting === 0) {
        if (inFlight.get(flight.key) === flight) {
          inFlight.delete(flight.key)
        }

        flight.controller.abort(signal.reason)
      }

      reject(abortError(signal))
    }

    flight.waiting += 1
    signal.addEventListener('abort', onAbort, { once: true })
    // why-safe: the key names the request, and one request settles to one result type.
    flight.pass.then(
      (value) => {
        leave()
        resolve(value as T)
      },
      (err: unknown) => {
        leave()
        reject(err)
      }
    )
  })
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
 *  symbols resolving together, while a lookup that does vary by symbol keeps its own key. A feed
 *  request names its feed rather than a path, and a header can change the answer, so both join it. */
export function providerRequestKey(request: SourceRequest): string {
  return [
    request.sourceId,
    request.feedId ?? '',
    request.path,
    valueKey(request.query ?? {}),
    valueKey(request.headers ?? {}),
  ].join('|')
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
