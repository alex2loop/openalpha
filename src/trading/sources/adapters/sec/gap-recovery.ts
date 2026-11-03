import type { Ticker } from '@/trading/kernel/instrument'
import type { AnnualAccounts } from '@/trading/kernel/market/annual-accounts'
import type { CompanyConcept, ConceptFact } from '@/trading/sources/adapters/sec/concept-facts'
import type { FrameAnswer } from '@/trading/sources/adapters/sec/frame-jobs'
import type { SourceHttp } from '@/trading/sources/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { SEC_CREDENTIAL, SEC_DATA_ID } from '@/trading/sources/adapters/sec/client'
import {
  annualConceptFacts,
  CONCEPT,
  conceptJobs,
} from '@/trading/sources/adapters/sec/concept-facts'
import { US_GAAP_CONCEPTS } from '@/trading/sources/adapters/sec/concepts'
import {
  BUSINESS_MISS_STATUSES,
  FRAME_CONCURRENCY,
  US_GAAP_UNIT,
} from '@/trading/sources/adapters/sec/frame-jobs'

/** The frames keep one fact per company per calendar year, so a 52/53-week filer whose year ends
 *  either side of a half-year boundary (Sysco: 2023-07-01, then 2024-06-29) puts two years in one
 *  frame and the other is lost. The company's own concept history has both. Bounded to the few
 *  companies with an interior hole. */
const MAXIMUM_GAP_COMPANIES = 25

interface ConceptRead {
  readonly http: SourceHttp
  readonly signal: AbortSignal
}

interface ConceptItem extends CompanyConcept {
  readonly years: ReadonlySet<number>
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
  const jobs = conceptJobs(US_GAAP_CONCEPTS, US_GAAP_UNIT)
  const reads = gaps.flatMap(([cik, years]) => jobs.map((job) => ({ cik, years, job })))
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
    (raw) => annualConceptFacts(CONCEPT.parse(raw), item)
  )

  return outcome.kind === 'ok' ? answersFor(outcome.value, item) : []
}

/** Only the years the frames lost: the rest are already served and must not be overwritten. */
function answersFor(facts: readonly ConceptFact[], item: ConceptItem): readonly FrameAnswer[] {
  return [{ job: item.job.job, facts: facts.filter((fact) => item.years.has(fact.fiscalYear)) }]
}
