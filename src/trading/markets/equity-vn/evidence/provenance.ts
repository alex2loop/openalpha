import type { BarRecord } from '@/trading/kernel/market/market-data'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'

/** The freshest bar per name, not every bar: one stamp answers which source backed this name and
 *  when it was fetched, while the full series would repeat that stamp once per session. */
export function latestBarProvenance(name: {
  readonly bars: readonly BarRecord[]
}): readonly SourceProvenance[] {
  const latest = name.bars[name.bars.length - 1]

  if (latest === undefined) {
    return []
  }

  return [{ sourceId: latest.sourceId, fetchedAt: latest.fetchedAt, freshness: 'cached' }]
}
