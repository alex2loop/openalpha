import type {
  BriefNumericField,
  BriefSectionKind,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import { sectionNumber, sectionSessions } from '@/trading/kernel/operator/brief-section'
import { omitted, ready } from '@/trading/markets/equity-vn/brief/sections'

interface ComparedFact {
  readonly kind: BriefSectionKind
  readonly field: BriefNumericField
  /** The previous-value field in this fact's own unit: one formatter cannot serve a ratio, a
   *  multiple, and money at once. */
  readonly previous: BriefNumericField
}

/** The facts worth comparing across two sessions, and the only ones. Each names the section it is
 *  read from and the field inside it, so a section that changes shape breaks here loudly rather
 *  than silently comparing nothing. */
const COMPARED_FACTS = Object.freeze([
  { kind: 'breadth', field: 'aboveMa50Ratio', previous: 'previousFraction' },
  { kind: 'breadth', field: 'indexToMa50Pct', previous: 'previousSignedFraction' },
  { kind: 'tape', field: 'turnoverRatio', previous: 'previousMultiple' },
  // The section total, not a board row: `foreignNetBase` lives only on per-board rows, and the
  // first of those is one exchange's flow read as the market's.
  { kind: 'foreign-desk-flow', field: 'net', previous: 'previousSignedFlow' },
  { kind: 'book-summary', field: 'nav', previous: 'previousFlow' },
] as const satisfies readonly ComparedFact[])

/** What moved since the last brief: one row per fact both sessions hold, and only when the two
 *  sides differ. Absent whole when there is no previous snapshot; a first-ever brief prints no
 *  block rather than five arrows from nothing. */
export async function buildSessionDelta(
  context: BriefContext,
  sections: readonly BriefSectionResult[]
): Promise<BriefSectionResult> {
  const previous = await context.services.previousSections({
    before: context.request.asOf,
    locale: context.request.locale,
    signal: context.request.signal,
  })

  if (previous === null) {
    return omitted('session-delta')
  }

  const rows = COMPARED_FACTS.flatMap((fact) => deltaRow(fact, previous, sections) ?? [])

  return rows.length === 0 ? omitted('session-delta') : ready('session-delta', rows)
}

function deltaRow(
  fact: ComparedFact,
  previous: readonly BriefSectionResult[],
  current: readonly BriefSectionResult[]
): BriefSectionRow | undefined {
  const was = sectionNumber(previous, fact.kind, fact.field)
  const now = sectionNumber(current, fact.kind, fact.field)

  if (was === undefined || now === undefined || was === now) {
    return undefined
  }

  return { [fact.previous]: was, [fact.field]: now, ...sectionSessions(current, fact.kind) }
}
