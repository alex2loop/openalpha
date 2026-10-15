import type { Locale } from '@/core/types/locale'
import type {
  BucketResult,
  ScoreBucket,
  ScorecardLine,
  ThemeScorecard,
} from '@/trading/features/themes/types'
import { t } from '@/i18n'
import {
  OUTCOME_HORIZONS_MONTHS,
  SCORE_BUCKET_FLOORS,
  SCORE_BUCKETS,
} from '@/trading/features/themes/types'
import { formatSignedFraction } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR } from '@/trading/render/layout'

/** Whether higher scores have done better, per horizon, with the counts beside every number. */
export function renderScorecard(scorecard: ThemeScorecard, locale: Locale): readonly string[] {
  const title = t(locale, 'trading.render.themes.trackRecord')

  if (scorecard.lines.length === 0) {
    return [
      title,
      `${INDENT[1]}${t(locale, 'trading.render.themes.noTrackRecord', {
        months: Math.min(...OUTCOME_HORIZONS_MONTHS),
      })}`,
    ]
  }

  return [title, ...scorecard.lines.flatMap((line) => renderLine(line, locale))]
}

function renderLine(line: ScorecardLine, locale: Locale): readonly string[] {
  const buckets = line.buckets.map((bucket) => renderBucket(bucket, locale)).join(INLINE_SEPARATOR)
  const verdict =
    line.separates === undefined
      ? []
      : [
          `${INDENT[2]}${t(
            locale,
            line.separates
              ? 'trading.render.themes.separates'
              : 'trading.render.themes.notSeparating'
          )}`,
        ]

  return [
    `${INDENT[1]}${t(locale, 'trading.render.themes.trackLine', {
      months: line.horizonMonths,
      level: t(locale, `trading.themes.level.${line.level}`),
      buckets,
    })}`,
    ...verdict,
  ]
}

function renderBucket(result: BucketResult, locale: Locale): string {
  const bucket = renderBucketName(result.bucket, locale)

  if (result.reads === 0) {
    return t(locale, 'trading.render.themes.bucketEmpty', { bucket })
  }

  return result.excessReturn === undefined
    ? t(locale, 'trading.render.themes.bucketThin', { bucket, reads: result.reads })
    : t(locale, 'trading.render.themes.bucketResult', {
        bucket,
        excess: formatSignedFraction(locale, result.excessReturn),
        reads: result.reads,
      })
}

/** From the floors, so a change of bands never leaves a label behind. */
function renderBucketName(bucket: ScoreBucket, locale: Locale): string {
  const index = SCORE_BUCKETS.indexOf(bucket)
  const above = SCORE_BUCKETS[index - 1]
  const from = SCORE_BUCKET_FLOORS[bucket]

  if (above === undefined) {
    return t(locale, 'trading.render.themes.bucketFrom', { from })
  }

  const to = SCORE_BUCKET_FLOORS[above]

  return index === SCORE_BUCKETS.length - 1
    ? t(locale, 'trading.render.themes.bucketBelow', { to })
    : t(locale, 'trading.render.themes.bucketRange', { from, to })
}
