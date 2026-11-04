import type { Locale } from '@/core/types/locale'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type { RenderContext } from '@/trading/render/format'
import type { RowUnit } from '@/trading/render/section-values'
import { type MessageKey, t } from '@/i18n'
import { INDENT, INLINE_SEPARATOR } from '@/trading/render/layout'
import { renderBriefSection, titleParamsOf } from '@/trading/render/section'
import { renderValue } from '@/trading/render/section-values'
import { toTable } from '@/trading/render/table'

/** The sections `/overview` states as labelled facts under a heading rather than as text rows, in
 *  the order a section lists them. */
const FACT_KINDS = Object.freeze(['derivatives', 'taker-flow', 'sentiment', 'premium'] as const)

type FactKind = (typeof FACT_KINDS)[number]

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

const HEADING_KEYS = Object.freeze({
  derivatives: 'trading.render.overview.section.derivatives',
  'taker-flow': 'trading.render.overview.section.taker-flow',
  sentiment: 'trading.render.overview.section.sentiment',
  premium: 'trading.render.overview.section.premium',
} as const satisfies Record<FactKind, MessageKey>)

/** The date a section is read at, for the sections that state one: an instant or a session. */
const NOTE_KEYS = Object.freeze({
  derivatives: 'trading.render.overview.note.derivatives',
  'taker-flow': 'trading.render.overview.note.taker-flow',
} as const satisfies Partial<Record<FactKind, MessageKey>>)

const LABEL_KEYS = Object.freeze({
  funding: 'trading.render.overview.fact.funding',
  openInterest: 'trading.render.overview.fact.openInterest',
  oiRatio: 'trading.render.overview.fact.oiRatio',
  longShortRatio: 'trading.render.overview.fact.longShortRatio',
  takerBuyPct: 'trading.render.overview.fact.takerBuyPct',
  sentimentScore: 'trading.render.overview.fact.sentimentScore',
  premium: 'trading.render.overview.fact.premium',
} as const satisfies Record<FactField, MessageKey>)

/** One reading of a section: its label, its value with the unit, and where it stands against its
 *  own history where the read carries that. Both the terminal and the page lay these out. */
interface OverviewFact {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly rank?: string
}

/** A heading over its facts. The date a section was read at is `note`, stated once beside the
 *  heading and never repeated in a fact. */
export interface OverviewFactSection {
  readonly kind: string
  readonly heading: string
  readonly note?: string
  readonly facts: readonly OverviewFact[]
}

function isFactKind(kind: string): kind is FactKind {
  return FACT_KINDS.some((known) => known === kind)
}

/** The facts of a section `/overview` lists as facts; absent for any other section and for one
 *  that failed, which keeps its text rendering and its caveat. */
export function toOverviewFacts(
  locale: Locale,
  section: BriefSectionResult,
  timezone: string
): OverviewFactSection | undefined {
  if (section.status !== 'ready' || !isFactKind(section.kind)) {
    return undefined
  }

  const { kind } = section
  const noteKey = kind === 'derivatives' || kind === 'taker-flow' ? NOTE_KEYS[kind] : undefined
  const unit: RowUnit = section.currency === undefined ? {} : { currency: section.currency }

  return {
    kind,
    heading: t(locale, HEADING_KEYS[kind]),
    ...(noteKey === undefined
      ? {}
      : { note: t(locale, noteKey, titleParamsOf(section, locale, timezone)) }),
    facts: section.rows.flatMap((row) => factsOf(locale, row, unit)),
  }
}

function factsOf(locale: Locale, row: BriefSectionRow, unit: RowUnit): readonly OverviewFact[] {
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

/** A section as `/overview` prints it: the section's own text where it lists no facts, else its
 *  heading and one `Label: value` line per fact, the values in a column where the terminal can
 *  align them. */
export function renderOverviewSection(
  locale: Locale,
  section: BriefSectionResult,
  context: RenderContext
): string {
  const facts = toOverviewFacts(locale, section, context.timezone)

  if (facts === undefined) {
    return renderBriefSection(locale, section, context)
  }

  const heading =
    facts.note === undefined ? facts.heading : `${facts.heading}${INLINE_SEPARATOR}${facts.note}`
  const lines =
    context.layout === 'table'
      ? toTable(
          facts.facts.map((fact) => [`${fact.label}:`, factText(locale, fact)]),
          ['left', 'left']
        )
      : facts.facts.map((fact) =>
          t(locale, 'trading.render.metric.row', {
            label: fact.label,
            value: factText(locale, fact),
          })
        )

  return [heading, ...lines.map((line) => `${INDENT[1]}${line}`)].join('\n')
}

function factText(_locale: Locale, fact: OverviewFact): string {
  return fact.rank === undefined ? fact.value : `${fact.value}${INLINE_SEPARATOR}${fact.rank}`
}
