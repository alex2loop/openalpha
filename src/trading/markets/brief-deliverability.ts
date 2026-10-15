import type { BriefSectionKind, BriefSectionResult } from '@/trading/kernel/operator/brief-section'

/** Named sections, not a count: "at least five sections worked" is satisfiable entirely by sections
 *  nobody reads, and a brief missing today's suggestions is not a brief. The market rule is the
 *  market-agnostic half: one market going quiet degrades the brief, every market going quiet leaves
 *  nothing worth sending — and no single market's gap can suppress the others. */
export function isDeliverable(
  sections: readonly BriefSectionResult[],
  coreSections: readonly BriefSectionKind[]
): boolean {
  const readyKinds = new Set(
    sections.filter((section) => section.status === 'ready').map((section) => section.kind)
  )

  if (!coreSections.every((kind) => readyKinds.has(kind))) {
    return false
  }

  return sections.some((section) => section.market !== undefined && section.status === 'ready')
}
