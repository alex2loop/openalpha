import type { ReduceVerdicts } from '@/trading/features/portfolio/types'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { EvidenceReduceReasonCode } from '@/trading/kernel/caveat'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

/** Matches the candidate sweep's width: both fan out over the same book against the same database. */
const VERDICT_CONCURRENCY = 5

type VerdictStore = Pick<SuggestionStore, 'findLatestVerdict'>

/** The book's `ReduceVerdicts` seam, answered off the suggestion store, which the book may not
 *  import. One row per name and only for the names it already holds, so the sweep is the size of
 *  the book rather than of the screen. */
export function createReduceVerdicts(store: VerdictStore): ReduceVerdicts {
  return {
    async standing(options) {
      const entries = await mapWithConcurrency(
        options.instruments,
        VERDICT_CONCURRENCY,
        (instrument) => standingReduce(store, instrument, options.signal)
      )

      return new Map(entries.filter((entry) => entry !== null))
    },
  }
}

async function standingReduce(
  store: VerdictStore,
  instrument: InstrumentRef,
  signal: AbortSignal
): Promise<readonly [string, EvidenceReduceReasonCode] | null> {
  const verdict = await store.findLatestVerdict({
    market: instrument.market,
    ticker: instrument.ticker,
    signal,
  })
  const reason = verdict !== null && isStandingSale(verdict) ? verdict.reduceReasonCode : undefined

  // `over-target` is the rebalancer's own drift rule written back to the store, so closing a name on
  // it would let that fold veto itself.
  return reason === undefined || reason === 'over-target'
    ? null
    : [buildInstrumentKey(instrument), reason]
}

/** A sale the evidence called, whether it is still to be made or was already made on this holding:
 *  either way the evidence stands against the name. A declined reduce is neither. */
function isStandingSale(verdict: StoredSuggestion): boolean {
  return verdict.action === 'hold'
    ? verdict.holdReasonCodes.includes('evidence-sold')
    : verdict.action === 'reduce'
}
