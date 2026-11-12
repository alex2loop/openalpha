import type { Locale } from '@/core/types/locale'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type { RenderContext } from '@/trading/render/format'
import { type MessageKey, t } from '@/i18n'
import { INDENT, INLINE_SEPARATOR } from '@/trading/render/layout'
import { type RowUnit, renderValue, unitOfSection } from '@/trading/render/section-values'
import { toTable } from '@/trading/render/table'

/** The sections every surface states as labelled facts rather than as text rows. */
const FACT_KINDS = Object.freeze(['derivatives', 'taker-flow', 'sentiment', 'premium'] as const)

/** The fields a fact section lists, in the order it lists them. */
const FACT_FIELDS = Object.freeze([
  'funding',
  'openInterest',
  'oiRatio',
  'longShortRatio',
  'takerBuyPct',
  'sentimentScore',
  'premium',
] as const)

type FactField = (typeof FACT_FIELDS)[number]

const LABEL_KEYS = Object.freeze({
  funding: 'trading.brief.fact.funding',
  openInterest: 'trading.brief.fact.openInterest',
  oiRatio: 'trading.brief.fact.oiRatio',
  longShortRatio: 'trading.brief.fact.longShortRatio',
  takerBuyPct: 'trading.brief.fact.takerBuyPct',
  sentimentScore: 'trading.brief.fact.sentimentScore',
  premium: 'trading.brief.fact.premium',
} as const satisfies Record<FactField, MessageKey>)

/** One reading of a section: its label, its value with the unit, and where it stands against its
 *  own history where the read carries that. Every surface lays these out. */
export interface SectionFact {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly rank?: string
}

/** The facts of a section stated as facts; absent for any other section and for one that failed,
 *  which keeps its text rendering and its caveat. */
export function toSectionFacts(
  locale: Locale,
  section: BriefSectionResult
): readonly SectionFact[] | undefined {
  if (section.status !== 'ready' || !FACT_KINDS.some((kind) => kind === section.kind)) {
    return undefined
  }

  const unit = unitOfSection(section)

  return section.rows.flatMap((row) => factsOf(locale, row, unit))
}

/** One `Label: value` line per fact under the section's heading, the values in a column where the
 *  terminal can align them. */
export function renderFactLines(
  locale: Locale,
  facts: readonly SectionFact[],
  context: RenderContext
): readonly string[] {
  const lines =
    context.layout === 'table'
      ? toTable(
          facts.map((fact) => [`${fact.label}:`, factText(fact)]),
          ['left', 'left']
        )
      : facts.map((fact) =>
          t(locale, 'trading.render.metric.row', { label: fact.label, value: factText(fact) })
        )

  return lines.map((line) => `${INDENT[1]}${line}`)
}

function factsOf(locale: Locale, row: BriefSectionRow, unit: RowUnit): readonly SectionFact[] {
  const sessions = typeof row.sessions === 'number' ? { sessions: row.sessions } : undefined

  return FACT_FIELDS.flatMap((field) => {
    const value = row[field]

    if (value === undefined) {
      return []
    }

    const rank = field === 'premium' ? premiumRankOf(locale, row, unit) : undefined

    return [
      {
        id: field,
        label: t(locale, LABEL_KEYS[field], sessions),
        value: renderValue(locale, [field, value], unit),
        ...(rank === undefined ? {} : { rank }),
      },
    ]
  })
}

/** Where today's premium sits among the sessions the read ranked it over. */
function premiumRankOf(locale: Locale, row: BriefSectionRow, unit: RowUnit): string | undefined {
  const { premiumPercentile, sessions } = row

  if (typeof premiumPercentile !== 'number' || typeof sessions !== 'number') {
    return undefined
  }

  const place = renderValue(locale, ['premiumPercentile', premiumPercentile], unit)

  return `${t(locale, 'trading.brief.field.premiumPercentile', { sessions })} ${place}`
}

function factText(fact: SectionFact): string {
  return fact.rank === undefined ? fact.value : `${fact.value}${INLINE_SEPARATOR}${fact.rank}`
}
