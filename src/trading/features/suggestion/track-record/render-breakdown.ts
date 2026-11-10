import type { Locale } from '@/core/types/locale'
import type {
  TrackRecordModelCount,
  TrackRecordVersionCount,
} from '@/trading/features/suggestion/track-record/types'
import { type MessageKey, pluralKey, t } from '@/i18n'
import { renderRateRange } from '@/trading/features/suggestion/track-record/rate-range'
import { formatCount, formatWholeFraction, SECTION_ICONS } from '@/trading/render/format'
import { INDENT, renderSectionTitle } from '@/trading/render/layout'

/** Versions sort as numbers in every host locale. */
const VERSION_COLLATION_LOCALE = 'en'

/** Singular and plural forms, in `pluralKey` order. */
const VERSION_LINE_KEYS = [
  'trading.render.reflect.versionLineOne',
  'trading.render.reflect.versionLine',
] as const satisfies readonly [MessageKey, MessageKey]
const DEBATE_MODEL_LINE_KEYS = [
  'trading.render.reflect.debateModelLineOne',
  'trading.render.reflect.debateModelLine',
] as const satisfies readonly [MessageKey, MessageKey]
const DEBATE_MODEL_RATED_LINE_KEYS = [
  'trading.render.reflect.debateModelRatedLineOne',
  'trading.render.reflect.debateModelRatedLine',
] as const satisfies readonly [MessageKey, MessageKey]

/** One version is not a split, so the section stays out until there are two. */
export function renderVersionLines(
  locale: Locale,
  versions: readonly TrackRecordVersionCount[]
): readonly string[] {
  const counts = countsByVersion(versions)

  if (counts.length < 2) {
    return []
  }

  return [
    renderSectionTitle(SECTION_ICONS.breakdown, t(locale, 'trading.render.reflect.byVersion')),
    ...counts.map(
      ([version, count]) =>
        `${INDENT[1]}${t(locale, pluralKey(count, ...VERSION_LINE_KEYS), {
          version,
          n: formatCount(locale, count),
        })}`
    ),
  ]
}

/** One line per strategy version, newest first. Rows that differ only in a calculation version read
 *  as the same version twice to the operator, so their counts sum. */
function countsByVersion(
  versions: readonly TrackRecordVersionCount[]
): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>()

  for (const entry of versions) {
    counts.set(
      entry.strategyVersion,
      (counts.get(entry.strategyVersion) ?? 0) + entry.resolvedCount
    )
  }

  return [...counts].sort(([left], [right]) =>
    right.localeCompare(left, VERSION_COLLATION_LOCALE, { numeric: true })
  )
}

export function renderDebateModelLines(
  locale: Locale,
  models: readonly TrackRecordModelCount[]
): readonly string[] {
  if (models.length < 2) {
    return []
  }

  return [
    renderSectionTitle(SECTION_ICONS.breakdown, t(locale, 'trading.render.reflect.byDebateModel')),
    ...models.map((entry) => `${INDENT[1]}${renderDebateModelLine(locale, entry)}`),
  ]
}

function renderDebateModelLine(locale: Locale, entry: TrackRecordModelCount): string {
  const count = entry.resolvedCount
  const params = { models: entry.models.join(', '), n: formatCount(locale, count) }

  return entry.winRate === undefined
    ? t(locale, pluralKey(count, ...DEBATE_MODEL_LINE_KEYS), params)
    : t(locale, pluralKey(count, ...DEBATE_MODEL_RATED_LINE_KEYS), {
        ...params,
        rate: formatWholeFraction(locale, entry.winRate),
        range: renderRateRange(locale, entry, formatWholeFraction),
      })
}
