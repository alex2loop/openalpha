import type { Caveat } from '@/trading/kernel/caveat'
import type { EventsRequest } from '@/trading/kernel/market/market-capability'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import {
  available,
  dedupeProvenance,
  isSourceFailed,
  unavailable,
} from '@/trading/kernel/source/source-result'
import { instrumentKindOf } from '@/trading/markets/equity-us/bars'
import { US_MARKET_REF } from '@/trading/markets/equity-us/policy'

/** Every provider routed for the kind answers, and the answers are merged: Nasdaq dates the
 *  dividends and SEC the filings, so a first-wins failover would drop one half. Soonest first, one
 *  row per (kind, day, title). Unavailable only when no provider could answer. */
export async function runUsEvents(
  deps: MarketDeps,
  request: EventsRequest
): Promise<SourceResult<readonly MarketEvent[]>> {
  const reads = await deps.sources.resolveAll({
    kind: 'events',
    context: {
      market: US_MARKET_REF,
      instrument: request.instrument,
      fromDay: request.fromDay,
      toDay: request.asOf,
      ...(await instrumentKindOf(deps, request)),
    },
    signal: request.signal,
  })
  const answers = reads.flatMap((read) => (read.kind === 'available' ? [read] : []))
  const caveats: readonly Caveat[] = dedupeCaveats(reads.flatMap((read) => read.caveats))

  if (answers.length === 0) {
    // Only an outage is a failed calendar: a name no routed provider covers (a fund) has no
    // calendar to read, and saying it failed would tell the debate not to assume nothing is due.
    return unavailable(
      reads.some((read) => isSourceFailed(read)) ? 'failed' : 'unsupported',
      reads.flatMap((read) => (read.kind === 'unavailable' ? read.attemptedSourceIds : [])),
      caveats
    )
  }

  const provenance: readonly SourceProvenance[] = dedupeProvenance(
    answers.flatMap((read) => read.provenance)
  )

  return available(mergeEvents(answers.flatMap((read) => read.value)), provenance, caveats)
}

function mergeEvents(events: readonly MarketEvent[]): readonly MarketEvent[] {
  const seen = new Set<string>()

  return events
    .toSorted((left, right) => left.at.localeCompare(right.at))
    .filter((event) => {
      const key = `${event.kind}|${event.at}|${event.title}`

      if (seen.has(key)) {
        return false
      }

      seen.add(key)

      return true
    })
}
