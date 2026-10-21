import { z } from 'zod'

import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { AnnualAccounts } from '@/trading/kernel/market/annual-accounts'
import type { FrameAnswer, FrameFact, FrameJob } from '@/trading/sources/adapters/sec/frame-jobs'
import type { SourceHttp } from '@/trading/sources/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { MS_PER_DAY } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'
import { SEC_CREDENTIAL, SEC_DATA_ID } from '@/trading/sources/adapters/sec/client'
import { FLOW_CONCEPTS, INSTANT_CONCEPTS } from '@/trading/sources/adapters/sec/concepts'
import {
  BUSINESS_MISS_STATUSES,
  FRAME_CONCURRENCY,
  fiscalYearOf,
  usGaapJob,
} from '@/trading/sources/adapters/sec/frame-jobs'
import { dropInvalid, parseRow, utcDayStartEpochMs } from '@/trading/sources/rows/normalization'

/** The frames keep one fact per company per calendar year, so a 52/53-week filer whose year ends
 *  either side of a half-year boundary (Sysco: 2023-07-01, then 2024-06-29) puts two years in one
 *  frame and the other is lost. The company's own concept history has both. Bounded to the few
 *  companies with an interior hole. */
const MAXIMUM_GAP_COMPANIES = 25

const ANNUAL_DAYS_MINIMUM = 330

const ANNUAL_DAYS_MAXIMUM = 400

const CONCEPT = z.object({ units: z.record(z.string(), z.array(z.unknown())) })

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

interface ConceptJob {
  readonly job: FrameJob
  readonly shape: ConceptShape
}

interface ConceptRead {
  readonly http: SourceHttp
  readonly signal: AbortSignal
}

interface ConceptFact extends FrameFact {
  readonly fiscalYear: number
  readonly filed: string
}

interface ConceptItem {
  readonly cik: string
  readonly years: ReadonlySet<number>
  readonly job: ConceptJob
}

/** Best effort: a read that fails leaves the hole it was asked to fill, which is what the frames
 *  alone would have served. */
export async function recoverGaps(
  read: ConceptRead,
  wanted: ReadonlyMap<string, readonly Ticker[]>,
  framed: readonly AnnualAccounts[]
): Promise<readonly FrameAnswer[]> {
  const gaps = [...interiorGaps(framed, wanted)]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .slice(0, MAXIMUM_GAP_COMPANIES)
  const reads = gaps.flatMap(([cik, years]) => conceptJobs().map((job) => ({ cik, years, job })))
  const answers = await mapWithConcurrency(reads, FRAME_CONCURRENCY, (item) =>
    readConcept(read, item)
  )

  return answers.flat()
}

/** The fiscal years strictly between a company's first and last reported ones that no row holds. */
function interiorGaps(
  rows: readonly AnnualAccounts[],
  wanted: ReadonlyMap<string, readonly Ticker[]>
): ReadonlyMap<string, ReadonlySet<number>> {
  const ciks = new Map([...wanted].flatMap(([cik, codes]) => codes.map((code) => [code, cik])))
  const reported = new Map<string, Set<number>>()

  for (const row of rows) {
    const cik = ciks.get(row.instrument.ticker)

    if (cik !== undefined) {
      reported.set(cik, (reported.get(cik) ?? new Set<number>()).add(row.fiscalYear))
    }
  }

  const gaps = new Map<string, ReadonlySet<number>>()

  for (const [cik, years] of reported) {
    const missing = new Set<number>()

    for (let year = Math.min(...years); year < Math.max(...years); year += 1) {
      if (!years.has(year)) {
        missing.add(year)
      }
    }

    if (missing.size > 0) {
      gaps.set(cik, missing)
    }
  }

  return gaps
}

function conceptJobs(): readonly ConceptJob[] {
  const flows = FLOW_CONCEPTS.flatMap((concept) =>
    concept.tags.map((tag, priority) => ({
      job: usGaapJob({ line: concept.line, tag, priority }, 'FY'),
      shape: 'flow' as const,
    }))
  )
  const instants = INSTANT_CONCEPTS.flatMap((concept) =>
    concept.tags.map((tag, priority) => ({
      job: { ...usGaapJob({ line: concept.line, tag, priority }, 'Q4I'), instantYear: 0 },
      shape: 'instant' as const,
    }))
  )

  return [...flows, ...instants]
}

async function readConcept(read: ConceptRead, item: ConceptItem): Promise<readonly FrameAnswer[]> {
  const { job } = item.job
  const outcome = await read.http.getJson(
    {
      sourceId: SEC_DATA_ID,
      path: `/api/xbrl/companyconcept/CIK${item.cik}/${job.taxonomy}/${job.tag}.json`,
      credential: SEC_CREDENTIAL,
      businessMissStatuses: BUSINESS_MISS_STATUSES,
      signal: read.signal,
    },
    (raw) => annualConceptFacts(raw, item)
  )

  return outcome.kind === 'ok' ? answersFor(outcome.value, item) : []
}

/** Facts a 10-K reported for a whole year, newest filing first so a restated year reads as filed
 *  last. A comparative column repeats in the next 10-K; dating each by its own end keeps it once. */
function annualConceptFacts(raw: unknown, item: ConceptItem): readonly ConceptFact[] {
  const { job } = item.job
  const rows = CONCEPT.parse(raw).units[job.unit] ?? []
  const seen = new Set<string>()

  return dropInvalid(rows, (row) => toConceptFact(row, item))
    .flatMap((fact) => (fact === undefined ? [] : [fact]))
    .toSorted((left, right) => right.filed.localeCompare(left.filed))
    .filter((fact) => {
      const key = `${fact.end}|${fact.fiscalYear}`

      return seen.has(key) ? false : Boolean(seen.add(key))
    })
}

function toConceptFact(row: unknown, item: ConceptItem): ConceptFact | undefined {
  const { shape } = item.job
  const fact = parseRow(CONCEPT_FACT, row, 'sec concept fact')
  const end = tradingDay(fact.end)
  const fiscalYear = fiscalYearOf(end)

  if (!fact.form.startsWith('10-K')) {
    return undefined
  }

  // A flow covers a year; an instant has no start at all.
  return isYearLong(fact.start, end) === (shape === 'flow')
    ? { cik: item.cik, end, value: fact.val, fiscalYear, filed: fact.filed }
    : undefined
}

function isYearLong(start: string | undefined, end: TradingDay): boolean {
  if (start === undefined) {
    return false
  }

  const days = (utcDayStartEpochMs(end) - utcDayStartEpochMs(tradingDay(start))) / MS_PER_DAY

  return days >= ANNUAL_DAYS_MINIMUM && days <= ANNUAL_DAYS_MAXIMUM
}

/** Only the years the frames lost: the rest are already served and must not be overwritten. */
function answersFor(facts: readonly ConceptFact[], item: ConceptItem): readonly FrameAnswer[] {
  const lost = facts.filter((fact) => item.years.has(fact.fiscalYear))
  const { job, shape } = item.job

  if (shape === 'flow') {
    return [{ job, facts: lost }]
  }

  return [...item.years].map((year) => ({
    job: { ...job, instantYear: year },
    facts: lost.filter((fact) => fact.fiscalYear === year),
  }))
}
