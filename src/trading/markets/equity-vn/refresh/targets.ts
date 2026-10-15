import type { InstrumentKind, InstrumentRef } from '@/trading/kernel/instrument'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { SourceContext } from '@/trading/kernel/source/source-result'
import { dedupeInstruments } from '@/trading/kernel/instrument'
import { findFrontMonthFuture } from '@/trading/markets/equity-vn/refresh/universe'

/** The listed names a market-wide read answers for in one query. The index and future legs are
 *  quoted one at a time, so they never belong to a shared window. */
export const BOARD_KINDS: readonly InstrumentKind[] = Object.freeze(['equity', 'etf'])

/** Which subjects a refresh kind asks the provider for. A `repair` set narrows a pass to the names
 *  an earlier one lost; the universe stays whole either way, so classes and legs still resolve.
 *  Every index the scope holds is a leg: the ETF benchmarks are read from the same store. */
export function barTargets(
  universe: readonly InstrumentRecord[],
  repair?: ReadonlySet<string>
): readonly InstrumentRef[] {
  const future = findFrontMonthFuture(universe)
  const legs = [
    ...universe.filter((record) => record.kind === 'index'),
    ...(future === undefined ? [] : [future]),
  ].map((record) => record.instrument)

  return repaired(dedupeInstruments([...tradeableTargets(universe, BOARD_KINDS), ...legs]), repair)
}

/** Indexes and futures carry no fundamentals or flows, and asking for them would count a guaranteed
 *  miss against the kind's coverage. */
export function tradeableTargets(
  universe: readonly InstrumentRecord[],
  kinds: readonly InstrumentKind[],
  repair?: ReadonlySet<string>
): readonly InstrumentRef[] {
  return repaired(
    dedupeInstruments(
      universe
        .filter((record) => record.status === 'active' && kinds.includes(record.kind))
        .map((record) => record.instrument)
    ),
    repair
  )
}

/** The universe is already in memory, so the class of a target costs no read. An index or a future
 *  fetched as if it were a share would come back from the wrong endpoint, or scaled by a thousand. */
export function seriesClass(
  universe: readonly InstrumentRecord[],
  instrument: InstrumentRef
): Pick<SourceContext, 'instrumentKind'> {
  const record = universe.find((entry) => entry.instrument.ticker === instrument.ticker)

  return record === undefined ? {} : { instrumentKind: record.kind }
}

/** A reference leg the repaired pass already stored is not refetched: asking for it again would
 *  count a second chance to fail against a name that never failed. */
function repaired(
  targets: readonly InstrumentRef[],
  repair: ReadonlySet<string> | undefined
): readonly InstrumentRef[] {
  return repair === undefined ? targets : targets.filter((target) => repair.has(target.ticker))
}
