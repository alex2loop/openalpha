import type { Locale } from '@/core/types/locale'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type {
  BriefField,
  BriefSectionKind,
  BriefSectionResult,
} from '@/trading/kernel/operator/brief-section'
import type { RenderContext } from '@/trading/render/format'
import { pluralKey, t } from '@/i18n'
import { sectionNumber, sectionSessions } from '@/trading/kernel/operator/brief-section'
import { formatCount, formatFraction, SECTION_ICONS } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { renderBlockRule, renderBriefSection, renderLabelledRow } from '@/trading/render/section'

/** The one section quoted whole, because its single row is already the sentence. */
const QUOTED_SECTION: BriefSectionKind = 'reading'

/** What the verdict takes from each section below it, by field rather than by section: two of the
 *  sections it reads are lists, and a verdict that quotes a list is the list again. Both halves of
 *  the trend ride together: a price above a falling average is the case the reassuring half alone
 *  would misreport. The prices are deliberately absent — the distances below say what the level
 *  means, and the block that states them sits three lines down. */
const QUOTED_FIELDS = Object.freeze([
  { kind: 'breadth', fields: ['aboveMa50Ratio', 'ma50Measured', 'indexToMa50Pct', 'ma50SlopePct'] },
  { kind: 'tape', fields: ['turnover', 'turnoverRatio'] },
  { kind: 'range', fields: ['supportPct', 'resistancePct'] },
] as const satisfies readonly { kind: BriefSectionKind; fields: readonly BriefField[] }[])

export function renderVerdictBlock(
  locale: Locale,
  sections: readonly BriefSectionResult[],
  context: RenderContext
): readonly string[] {
  const quoted = [
    ...renderQuotedReading(locale, sections, context),
    ...QUOTED_FIELDS.flatMap((quote) => renderQuotedFields(locale, sections, quote)),
  ]

  return quoted.length === 0
    ? []
    : [
        renderBlockRule(SECTION_ICONS.actions, t(locale, 'trading.brief.block.verdict')),
        ...quoted,
        ...todayLine(locale, sections),
      ]
}

/** The session sentence, without its heading: it appears again below, so the heading would be the
 *  one thing stated twice. */
function renderQuotedReading(
  locale: Locale,
  sections: readonly BriefSectionResult[],
  context: RenderContext
): readonly string[] {
  const section = sections.find((candidate) => candidate.kind === QUOTED_SECTION)

  if (section === undefined || section.status !== 'ready' || section.rows.length === 0) {
    return []
  }

  const [, ...lines] = renderBriefSection(locale, section, context).split('\n')

  return lines
}

/** One line per section, carrying only the fields named for it and each under the label its own
 *  rows already print. Absent when the section carried none of them. */
function renderQuotedFields(
  locale: Locale,
  sections: readonly BriefSectionResult[],
  quote: { readonly kind: BriefSectionKind; readonly fields: readonly BriefField[] }
): readonly string[] {
  const row: Record<string, number> = {}

  for (const field of quote.fields) {
    const value = sectionNumber(sections, quote.kind, field)

    if (value !== undefined) {
      row[field] = value
    }
  }

  if (Object.keys(row).length === 0) {
    return []
  }

  const quoted = { ...row, ...sectionSessions(sections, quote.kind) }

  const currency = currencyOf(sections, quote.kind)

  return [
    `${INDENT[1]}${renderLabelledRow(locale, quoted, currency === undefined ? {} : { currency })}`,
  ]
}

function currencyOf(
  sections: readonly BriefSectionResult[],
  kind: BriefSectionKind
): CurrencyCode | undefined {
  const section = sections.find((candidate) => candidate.kind === kind)

  return section?.status === 'ready' ? section.currency : undefined
}

/** The one restatement the block allows: what to deploy and how many things need doing. Absent
 *  when either input is missing rather than half-stated. */
function todayLine(locale: Locale, sections: readonly BriefSectionResult[]): readonly string[] {
  const deployment = sectionNumber(sections, 'macro', 'deploymentScale')
  const actions = sections.find((section) => section.kind === 'next-actions')
  const count =
    actions !== undefined && actions.status === 'ready' ? actions.rows.length : undefined

  if (deployment === undefined || count === undefined) {
    return []
  }

  const key =
    count === 0
      ? 'trading.brief.verdict.todayIdle'
      : pluralKey(count, 'trading.brief.verdict.todayOne', 'trading.brief.verdict.today')

  return [
    `${INDENT[1]}${t(locale, key, {
      deployment: formatFraction(locale, deployment),
      ...(count === 0 ? {} : { count: formatCount(locale, count) }),
    })}`,
  ]
}
