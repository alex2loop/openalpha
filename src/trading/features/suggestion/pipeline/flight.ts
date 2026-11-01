import type { SuggestionRunOptions } from '@/trading/features/suggestion/pipeline/types'
import type {
  SuggestionIdentity,
  SuggestionRequest,
  SuggestionRunResult,
} from '@/trading/features/suggestion/types'
import type { DebateMode } from '@/trading/kernel/config'
import type { MarketResolution } from '@/trading/markets/types'
import { resolveDay } from '@/trading/features/market-data/resolve'
import { identityOf } from '@/trading/features/suggestion/pipeline/identity'
import { createSharedFlight } from '@/trading/kernel/shared-flight'

interface FlightRun {
  /** Runs the gated pipeline under the request it is given, whose signal the flight owns. */
  readonly run: (request: SuggestionRequest) => Promise<SuggestionRunResult>
  /** Tells the joining caller's surface it is waiting on another caller's run. */
  readonly onShared: () => void
}

/** The effective debate mode is part of the key, so a deeper request never joins a shallower run. */
function buildSuggestionFlightKey(identity: SuggestionIdentity, debateMode: DebateMode): string {
  return JSON.stringify([
    identity.market,
    identity.ticker,
    identity.strategyVersion,
    identity.focusKey,
    identity.asOf,
    debateMode,
  ])
}

/** One run per identity and depth: a second caller with the same key waits on the run already in
 *  flight instead of paying for another debate. A forced request never joins and never registers,
 *  and a non-forced caller arriving during a forced run starts its own run, because the forced one
 *  is not in the map for it to join. */
export function joinOrStartSuggestion(
  options: SuggestionRunOptions,
  resolution: Extract<MarketResolution, { readonly kind: 'resolved' }>,
  flightRun: FlightRun
): Promise<SuggestionRunResult> {
  const { deps, request } = options

  if (request.force === true) {
    return flightRun.run(request)
  }

  const key = buildSuggestionFlightKey(
    identityOf(resolution, resolveDay(resolution.market, request.now), request.focus.key),
    deps.policy.debateMode
  )
  const existing = deps.flights.get(key)

  if (existing?.live === true) {
    flightRun.onShared()

    // A joiner spent nothing here. If the starter leaves before its batch charges, that headline
    // cost is reported nowhere; accepted.
    return existing.attach(request.signal).then(markShared)
  }

  const flight = createSharedFlight((signal) => flightRun.run({ ...request, signal }))
  const evict = (): void => {
    if (deps.flights.get(key) === flight) {
      deps.flights.delete(key)
    }
  }

  deps.flights.set(key, flight)
  flight.work.then(evict, evict)

  return flight.attach(request.signal)
}

function markShared(result: SuggestionRunResult): SuggestionRunResult {
  return result.kind === 'completed' ? { ...result, shared: true } : result
}
