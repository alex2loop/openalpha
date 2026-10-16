import type { Locale } from '@/core/types/locale'
import type {
  FactorAttribution,
  FactorAttributionBucket,
  FactorReading,
} from '@/trading/kernel/factor'
import type { MarketRef } from '@/trading/kernel/instrument'
import { type MessageKey, t } from '@/i18n'
import {
  formatCount,
  formatFraction,
  formatSignedFraction,
  formatWholeFraction,
  renderDeclaredValue,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, renderSectionTitle } from '@/trading/render/layout'
import { apportion, WEIGHT_QUANTUM } from '@/trading/render/number'

const READING_KEYS = Object.freeze({
  bullish: 'trading.attribution.bullish',
  bearish: 'trading.attribution.bearish',
} as const satisfies Readonly<Record<FactorReading, MessageKey>>)
/** A market's newest versions are the ones a reader acts on; an older one only dilutes the list. */
const VERSIONS_PER_MARKET = 2
const GROUP_SEPARATOR = ' '

/** Rows arrive sorted by market, then strategy version, then factor, so a heading on each market and
 *  version boundary keeps a reader from comparing VN trend against crypto trend, or one
 *  version's trend against another's, as if they were one measurement. Weights round within a
 *  group.
 *  Sections rather than text: this is the fourth breakdown of the track record, spliced into the
 *  report that already carries the other three. */
export function renderAttributionSections(
  locale: Locale,
  rows: readonly FactorAttribution[],
  headingKey: MessageKey
): readonly (readonly string[])[] {
  if (rows.length === 0) {
    return []
  }

  const sections: (readonly string[])[] = [
    [renderSectionTitle(SECTION_ICONS.factors, t(locale, headingKey))],
  ]

  for (const group of byStrategy(rows)) {
    const [first] = group

    if (first === undefined) {
      continue
    }

    sections.push([
      `${INDENT[1]}${t(locale, 'trading.attribution.groupHeading', {
        market: renderDeclaredValue(locale, `trading.market.${first.market}`),
        version: first.strategyVersion,
      })}`,
      ...groupLines(locale, group),
    ])
  }

  return sections
}

/** A group none of whose factors has a rate yet is one line: a factor name with only its fire count
 *  answers nothing the reader asked. */
function groupLines(locale: Locale, group: readonly FactorAttribution[]): readonly string[] {
  const rated = group.some((row) => row.buckets.some((bucket) => bucket.hitRate !== undefined))

  if (!rated) {
    return [
      `${INDENT[2]}${t(locale, 'trading.attribution.groupThin', {
        count: formatCount(locale, group.length),
      })}`,
    ]
  }

  return roundedWeights(group).flatMap((row) => renderFactorLines(locale, row))
}

/** Rows arrive sorted by market, then newest version first, so the first versions seen per market
 *  are the ones kept. */
function byStrategy(rows: readonly FactorAttribution[]): readonly (readonly FactorAttribution[])[] {
  const groups = new Map<string, FactorAttribution[]>()
  const kept = new Map<MarketRef, Set<string>>()

  for (const row of rows) {
    const versions = kept.get(row.market) ?? new Set<string>()

    if (!versions.has(row.strategyVersion) && versions.size >= VERSIONS_PER_MARKET) {
      continue
    }

    versions.add(row.strategyVersion)
    kept.set(row.market, versions)

    const key = `${row.market}${GROUP_SEPARATOR}${row.strategyVersion}`
    const group = groups.get(key) ?? []

    group.push(row)
    groups.set(key, group)
  }

  return [...groups.values()]
}

/** One group's shares rounded together, because they are shares of that version's model and nothing
 *  else: nine equal weights each rounded on their own print a column summing to 99%. A market whose
 *  rows are not all weighted is left alone — a missing weight is not a zero share. */
function roundedWeights(rows: readonly FactorAttribution[]): readonly FactorAttribution[] {
  const weights = rows.flatMap((row) => (row.weight === undefined ? [] : [row.weight]))

  if (weights.length !== rows.length) {
    return rows
  }

  const rounded = apportion(weights, WEIGHT_QUANTUM)

  return rows.map((row, index) => {
    const weight = rounded[index]

    return weight === undefined ? row : { ...row, weight }
  })
}

/** No caveat line here: every thin factor raises the same subject-less sentence, so the report
 *  hoists them into the one deduped list it closes with. */
function renderFactorLines(locale: Locale, row: FactorAttribution): readonly string[] {
  const name = renderDeclaredValue(locale, `trading.factor.${row.factorId}`)

  const shared = { factor: name, n: formatCount(locale, row.firedCount) }

  return [
    `${INDENT[2]}${
      row.weight === undefined
        ? t(locale, 'trading.attribution.factorLine', shared)
        : t(locale, 'trading.attribution.factorLineWeighted', {
            ...shared,
            weight: formatWholeFraction(locale, row.weight),
          })
    }`,
    ...row.buckets.flatMap((bucket) => renderBucketLine(locale, bucket)),
  ]
}

/** A bucket below the sample minimum reports no rate upstream, so an absent one prints nothing
 *  rather than a number nobody should trust. */
function renderBucketLine(locale: Locale, bucket: FactorAttributionBucket): readonly string[] {
  const { hitRate, meanReturnPct } = bucket

  if (hitRate === undefined || meanReturnPct === undefined) {
    return []
  }

  return [
    `${INDENT[3]}${t(locale, 'trading.attribution.readingLine', {
      reading: t(locale, READING_KEYS[bucket.reading]),
      hits: formatCount(locale, bucket.hitCount),
      n: formatCount(locale, bucket.resolvedCount),
      rate: formatFraction(locale, hitRate),
      avg: formatSignedFraction(locale, meanReturnPct),
    })}`,
  ]
}
