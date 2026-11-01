import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { TaxonomyConcepts } from '@/trading/sources/adapters/sec/concepts'
import type { FrameFact, FrameJob } from '@/trading/sources/adapters/sec/frame-jobs'
import { MS_PER_DAY } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'
import { fiscalYearOf } from '@/trading/sources/adapters/sec/frame-jobs'
import { dropInvalid, parseRow, utcDayStartEpochMs } from '@/trading/sources/rows/normalization'

const ANNUAL_DAYS_MINIMUM = 330

const ANNUAL_DAYS_MAXIMUM = 400

/** A domestic filer's annual report and a foreign issuer's (a Canadian one files the 40-F). */
const ANNUAL_FORMS: readonly string[] = Object.freeze(['10-K', '20-F', '40-F'])

export const CONCEPT = z.object({ units: z.record(z.string(), z.array(z.unknown())) })

const CONCEPT_FACT = z.object({
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  form: z.string(),
  filed: z.string(),
})

/** How a company's own history dates a fact: a year-long flow or a balance-sheet instant. The
 *  cover-page share count is left to the frames: a 10-K labels it with SEC's fiscal year, which is
 *  not always the year the period end falls in (a February year end), and a wrong count is worse
 *  than an absent one. */
type ConceptShape = 'flow' | 'instant'

export interface ConceptJob {
  readonly job: FrameJob
  readonly shape: ConceptShape
}

/** One company's history of one tag. */
export interface CompanyConcept {
  readonly cik: string
  readonly job: ConceptJob
}

export interface ConceptFact extends FrameFact {
  readonly fiscalYear: number
  readonly filed: string
}

/** One job per tag, flows before instants, each line's tags in their order of preference. */
export function conceptJobs(concepts: TaxonomyConcepts, unit: string): readonly ConceptJob[] {
  const { taxonomy } = concepts
  const flows = concepts.flows.flatMap((concept) =>
    concept.tags.map((tag, priority) => ({
      job: { taxonomy, unit, period: 'FY', line: concept.line, tag, priority },
      shape: 'flow' as const,
    }))
  )
  const instants = concepts.instants.flatMap((concept) =>
    concept.tags.map((tag, priority) => ({
      job: {
        taxonomy,
        unit,
        period: 'Q4I',
        line: concept.line,
        tag,
        priority,
        atYearEnd: true as const,
      },
      shape: 'instant' as const,
    }))
  )

  return [...flows, ...instants]
}

/** Facts an annual report gave for a whole year, or its closing balance sheet, newest filing first
 *  so a restated year reads as filed last. A comparative column repeats in the next report; dating
 *  each by its own end keeps it once. */
export function annualConceptFacts(
  concept: z.infer<typeof CONCEPT>,
  read: CompanyConcept
): readonly ConceptFact[] {
  const rows = concept.units[read.job.job.unit] ?? []
  const seen = new Set<string>()

  return dropInvalid(rows, (row) => toConceptFact(row, read))
    .flatMap((fact) => (fact === undefined ? [] : [fact]))
    .toSorted((left, right) => right.filed.localeCompare(left.filed))
    .filter((fact) => {
      const key = `${fact.end}|${fact.fiscalYear}`

      return seen.has(key) ? false : Boolean(seen.add(key))
    })
}

function toConceptFact(row: unknown, read: CompanyConcept): ConceptFact | undefined {
  const fact = parseRow(CONCEPT_FACT, row, 'sec concept fact')
  const end = tradingDay(fact.end)
  const fiscalYear = fiscalYearOf(end)

  if (!ANNUAL_FORMS.some((form) => fact.form.startsWith(form))) {
    return undefined
  }

  // A flow covers a year; an instant has no start at all.
  return isYearLong(fact.start, end) === (read.job.shape === 'flow')
    ? { cik: read.cik, end, value: fact.val, fiscalYear, filed: fact.filed }
    : undefined
}

function isYearLong(start: string | undefined, end: TradingDay): boolean {
  if (start === undefined) {
    return false
  }

  const days = (utcDayStartEpochMs(end) - utcDayStartEpochMs(tradingDay(start))) / MS_PER_DAY

  return days >= ANNUAL_DAYS_MINIMUM && days <= ANNUAL_DAYS_MAXIMUM
}
