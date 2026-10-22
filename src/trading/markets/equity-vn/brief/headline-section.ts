import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import { absent, omitted, ready } from '@/trading/markets/equity-vn/brief/sections'
import {
  HEADLINES_PER_SECTION,
  normalizeTitle,
  publisherOf,
  withPublisherQuota,
} from '@/trading/markets/news'

/** Every feed failing is `unavailable`; a quiet read is `omitted-by-policy`. The two are different
 *  facts and a reader acts differently on each. `taken` excludes stories a macro block already
 *  stated, ahead of the per-section bound. */
export function toHeadlineSection(
  kind: 'headlines' | 'macro-headlines' | 'economy-headlines',
  result: SourceResult<readonly NewsItem[]>,
  taken: ReadonlySet<string> = new Set()
): BriefSectionResult {
  if (result.kind === 'unavailable') {
    return absent(kind, result.caveats)
  }

  const fresh = result.value.filter((item) => !taken.has(normalizeTitle(item.title)))
  const rows = withPublisherQuota(fresh, HEADLINES_PER_SECTION).map((item) => {
    const publisher = publisherOf(item)

    return {
      title: item.title,
      ...(publisher === undefined ? {} : { publisher }),
      url: item.url,
    }
  })

  return rows.length === 0
    ? omitted(kind)
    : ready(kind, rows, { caveats: result.caveats, provenance: result.provenance })
}
