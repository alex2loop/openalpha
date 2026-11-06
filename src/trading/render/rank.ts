import type { Locale } from '@/core/types/locale'
import { t } from '@/i18n'
import { formatCount } from '@/trading/render/format'

/** Each wording of a standing, with its two ends named: "above 0% of the names" reads oddly where
 *  "lowest on the board" says the same. */
const RANK_KEYS = Object.freeze({
  better: {
    between: 'trading.render.layout.percentRank',
    lowest: 'trading.render.layout.percentRankLowest',
    highest: 'trading.render.layout.percentRankHighest',
  },
  plain: {
    between: 'trading.render.layout.percentRankPlain',
    lowest: 'trading.render.layout.percentRankPlainLowest',
    highest: 'trading.render.layout.percentRankPlainHighest',
  },
  time: {
    between: 'trading.render.layout.timeRank',
    lowest: 'trading.render.layout.timeRankLowest',
    highest: 'trading.render.layout.timeRankHighest',
  },
} as const)
const RANK_TOP = 100

/** A rank over a few dozen peers, where every decimal is quantization rather than precision:
 *  84.78th of 46 names is the 85th, and printing the remainder claims a resolution it lacks. The
 *  standing is worded rather than written `p78`, a notation no message ever defined - it is still
 *  not a share, and what it says is how many of its peers this reading is above. `plain`, for a
 *  surface that passes no judgement, says it as a count of peers rather than as being better;
 *  `time` is where a series stands against its own past, a share of the window and never "better
 *  than", since a higher premium or a larger net long is neither better nor worse. */
export function formatPercentRank(
  locale: Locale,
  percent: number,
  wording: keyof typeof RANK_KEYS = 'better'
): string {
  const pct = Math.round(percent)
  const keys = RANK_KEYS[wording]

  if (pct <= 0) {
    return t(locale, keys.lowest)
  }

  return pct >= RANK_TOP
    ? t(locale, keys.highest)
    : t(locale, keys.between, { pct: formatCount(locale, pct) })
}
