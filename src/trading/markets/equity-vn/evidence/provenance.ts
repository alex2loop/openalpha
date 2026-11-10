import type { SourceStamp } from '@/trading/kernel/market/market-data'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'

/** The freshest bar per name, not every bar: one stamp answers which source backed this name and
 *  when it was fetched, while the full series would repeat that stamp once per session. */
export function latestBarProvenance(name: {
  readonly lastBar?: SourceStamp
}): readonly SourceProvenance[] {
  const { lastBar } = name

  if (lastBar === undefined) {
    return []
  }

  return [{ sourceId: lastBar.sourceId, fetchedAt: lastBar.fetchedAt, freshness: 'cached' }]
}
