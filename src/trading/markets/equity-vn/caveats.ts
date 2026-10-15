import type { Caveat } from '@/trading/kernel/caveat'
import type { SourceKind, SourceProvenance } from '@/trading/kernel/source/source-result'
import { sourcedCaveat } from '@/trading/kernel/caveat'

/** What to report for a read that produced nothing usable: an otherwise unexplained loss gets the
 *  provider-agnostic code rather than a message naming a provider these boundaries may not have.
 *  It still names what was being read — the code hoists to a message-level list where the section
 *  that lost it is no longer beside it. */
export function reportedCaveats(caveats: readonly Caveat[], kind: SourceKind): readonly Caveat[] {
  return caveats.length > 0
    ? caveats
    : [{ code: 'source.no-available-provider', detail: { sourceKind: kind } }]
}

export function buildPayloadRejectedCaveat(
  provenance: readonly SourceProvenance[],
  kind: SourceKind
): Caveat {
  return sourcedCaveat(
    'source.payload-rejected',
    provenance.map((stamp) => stamp.sourceId),
    { sourceKind: kind }
  )
}
