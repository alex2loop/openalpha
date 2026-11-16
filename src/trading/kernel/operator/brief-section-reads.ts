import type { MarketRef } from '@/trading/kernel/instrument'
import type {
  BriefField,
  BriefSectionKind,
  BriefSectionResult,
} from '@/trading/kernel/operator/brief-section'

/** The first numeric value a section list carries for a field, whatever row holds it: a total the
 *  first row states, or a board split the later ones do. */
export function sectionNumber(
  sections: readonly BriefSectionResult[],
  kind: BriefSectionKind,
  field: BriefField
): number | undefined {
  const section = sections.find((candidate) => candidate.kind === kind)

  if (section === undefined || section.status !== 'ready') {
    return undefined
  }

  for (const row of section.rows) {
    const value = row[field]

    if (typeof value === 'number') {
      return value
    }
  }

  return undefined
}

/** An operator who has recorded nothing: the book summary is omitted by policy, which is what a
 *  null book produces. A summary that is unavailable (the read threw) is not "no book", so a failed
 *  read never tells an operator with a real book to start one. */
export function hasNoBook(sections: readonly BriefSectionResult[]): boolean {
  return sections.find((section) => section.kind === 'book-summary')?.status === 'omitted-by-policy'
}

/** The window a section states, for a row rebuilt from its fields: a verdict line and a delta row
 *  both quote a section by field name, and a windowed label on either must name the span that
 *  section printed rather than nothing. */
export function sectionSessions(
  sections: readonly BriefSectionResult[],
  kind: BriefSectionKind
): { readonly sessions?: number } {
  const sessions = sectionNumber(sections, kind, 'sessions')

  return sessions === undefined ? {} : { sessions }
}

/** The market a composed brief is about: `marketSections` leads the market blocks with the home
 *  one, so the first section carrying a market names it. When the home block produced no sections
 *  that is another market's, and the strip, session and verdict then follow that market. */
export function homeMarketOf(sections: readonly BriefSectionResult[]): MarketRef | undefined {
  return sections.find((section) => section.market !== undefined)?.market
}
