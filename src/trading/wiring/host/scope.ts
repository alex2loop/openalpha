import type { Region } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { TradingHostDeps } from '@/trading/wiring/host/types'
import { ValidationError } from '@/core/errors'

/** A write to an exchange or the ledger runs on no caller signal: a client hanging up mid-fill must
 *  not abandon an order the exchange holds, split an exit's placement from the row that records it,
 *  or stop a sync halfway through its bookings. Shutdown and the slow ceiling still bound it. */
export const UNABORTED = new AbortController().signal

interface RequestScope {
  readonly signal: AbortSignal
  readonly now: number
}

/** One clock read per request, and one timeout that is always released. Guarding before arming
 *  matters: an already-aborted caller must not leave a timer pinning the event loop or a listener
 *  attached to the shutdown signal. */
async function scopedFor<T>(
  timeoutMs: number,
  context: { readonly deps: TradingHostDeps; readonly caller: AbortSignal },
  run: (scope: RequestScope) => Promise<T>
): Promise<T> {
  const { deps, caller } = context

  if (caller.aborted) {
    return Promise.reject(caller.reason)
  }

  if (deps.shutdownSignal.aborted) {
    return Promise.reject(deps.shutdownSignal.reason)
  }

  const timeout = new AbortController()
  const timer = setTimeout(
    () => timeout.abort(new DOMException('request timed out', 'TimeoutError')),
    timeoutMs
  )

  try {
    return await run({
      signal: AbortSignal.any([caller, deps.shutdownSignal, timeout.signal]),
      now: Date.now(),
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function scoped<T>(
  deps: TradingHostDeps,
  caller: AbortSignal,
  run: (scope: RequestScope) => Promise<T>
): Promise<T> {
  return scopedFor(deps.requestTimeoutMs, { deps, caller }, run)
}

/** The same scope for the reads that rank, value or refresh a whole market, which can outlast the
 *  ordinary ceiling on a cold store without anything being wrong. */
export async function scopedSlow<T>(
  deps: TradingHostDeps,
  caller: AbortSignal,
  run: (scope: RequestScope) => Promise<T>
): Promise<T> {
  return scopedFor(deps.slowRequestTimeoutMs, { deps, caller }, run)
}

export function profileOf(deps: TradingHostDeps, scope: RequestScope): Promise<UserProfile> {
  return deps.services.profiles.get({
    signal: scope.signal,
  })
}

/** A region arriving from a wire payload is never trusted as a lookup key; the market-data service is
 *  the only holder of the registry that can confirm it. An omitted one is the composed default. */
export function resolveRegion(deps: TradingHostDeps, requested: Region | undefined): Region {
  if (requested === undefined) {
    return deps.services.defaultRegion
  }

  if (!deps.services.marketData.regions().includes(requested)) {
    throw new ValidationError(`region ${requested} has no registered market`)
  }

  return requested
}

export function bounded(requested: number, maximum: number): number {
  if (!Number.isInteger(requested) || requested <= 0 || requested > maximum) {
    throw new ValidationError(`limit must be a whole number between 1 and ${maximum}`)
  }

  return requested
}
