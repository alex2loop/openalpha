import type { Caveat } from '@/trading/kernel/caveat'
import type { NewsItem } from '@/trading/kernel/market/market-data'
import { groupStories } from '@/trading/markets/news'

export const MINIMUM_RISK_EVENT_STORIES = 2

/** One entry per shock, holding its wording in every language the feeds carry. A language extends
 *  these entries rather than adding one, or the same event counts twice toward the threshold. Terms
 *  are regex fragments, which is what `invades?` needs.
 *
 *  Kinetic and state-action wording only: the bare words for war are absent because `trade war` and
 *  `chiến tranh thương mại` are metaphors, and a classifier that guesses is worse than one that
 *  abstains. Phrasings this misses stay missed — `hit by Russian drone` matches nothing here —
 *  because a term catching one phrasing widens what catches an accident, and a casualty pattern
 *  reads a cargo plane crash as a shock. Replace the table with a measured index, never grow it. */
const RISK_EVENT_TERMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  invasion: ['invasion', 'invades?', 'xung đột vũ trang'],
  airstrike: ['air ?strikes?', 'missile strikes?', 'không kích', 'tên lửa'],
  'martial-law': ['martial law', 'state of emergency', 'thiết quân luật'],
  coup: ['coup', 'đảo chính'],
  sanctions: ['sanctions? (?:on|against)', 'cấm vận'],
})

/** `\b` counts only ASCII word characters, so `\bđảo` asserts a boundary before a letter JavaScript
 *  does not count as one and never fires. These lookarounds read any script that spaces its words;
 *  a term in Chinese, Japanese or Thai would need a bare match, which no feed asks for yet. */
const RISK_EVENT_PATTERNS: readonly RegExp[] = Object.freeze(
  Object.values(RISK_EVENT_TERMS).map(
    (terms) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.join('|')})(?![\\p{L}\\p{N}])`, 'iu')
  )
)

/** Flags, and nothing more: no regime step and no factor score. Emerging markets overreact then
 *  reverse, and in crypto the sign differs by coin, so there is no direction a rule could take. */
export function riskEventCaveats(items: readonly NewsItem[]): readonly Caveat[] {
  const stories = groupStories(items).filter((group) => isRiskEvent(group.item.title))

  return stories.length < MINIMUM_RISK_EVENT_STORIES
    ? []
    : [{ code: 'market.risk-event-headlines', detail: { stories: stories.length } }]
}

/** Title only: the RSS adapter stores no summary, so there is no second field to read. */
function isRiskEvent(title: string): boolean {
  return RISK_EVENT_PATTERNS.some((pattern) => pattern.test(title))
}
