import { z } from 'zod'

import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { ConceptJob } from '@/trading/sources/adapters/sec/concept-facts'
import type { TaxonomyConcepts } from '@/trading/sources/adapters/sec/concepts'
import type { FrameAnswer } from '@/trading/sources/adapters/sec/frame-jobs'
import type { SourceHttp } from '@/trading/sources/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { isCurrencyCode } from '@/trading/kernel/instrument'
import { SEC_CREDENTIAL, SEC_DATA_ID } from '@/trading/sources/adapters/sec/client'
import {
  annualConceptFacts,
  CONCEPT,
  conceptJobs,
} from '@/trading/sources/adapters/sec/concept-facts'
import { COMPANY_FACT_TAXONOMIES } from '@/trading/sources/adapters/sec/concepts'
import {
  BUSINESS_MISS_STATUSES,
  FRAME_CONCURRENCY,
} from '@/trading/sources/adapters/sec/frame-jobs'

/** Names are asked largest first, so the cap only ever drops the smallest ones. */
const MAXIMUM_COMPANIES = 150
/** A company's whole history in one body: the largest board filers' run to 3.6 MB (Japanese and
 *  Canadian banks), past the shared cap, so this read declares its own. */
const COMPANY_FACTS_MAXIMUM_BYTES = 8_388_608

const COMPANY_FACTS = z.object({
  facts: z.record(z.string(), z.record(z.string(), z.unknown())),
})

type ConceptHistories = ReadonlyMap<string, z.infer<typeof CONCEPT>>

/** A company's annual lines in the currency it reports in. */
interface CompanyFiling {
  readonly currency: CurrencyCode
  readonly answers: readonly FrameAnswer[]
}

interface CompanyRead {
  readonly http: SourceHttp
  readonly signal: AbortSignal
}

/** The frames hold only facts filed in dollars under US GAAP, so a foreign issuer filing IFRS or in
 *  its home currency is in none of them; its own facts hold the same years. Best effort: a company
 *  that cannot be read stays absent, as the frames left it. */
export async function readCompanyFilings(
  read: CompanyRead,
  ciks: readonly string[]
): Promise<readonly CompanyFiling[]> {
  const filings = await mapWithConcurrency(
    ciks.slice(0, MAXIMUM_COMPANIES),
    FRAME_CONCURRENCY,
    (cik) => readCompanyFiling(read, cik)
  )

  return filings.flatMap((filing) => filing ?? [])
}

async function readCompanyFiling(
  read: CompanyRead,
  cik: string
): Promise<CompanyFiling | undefined> {
  const outcome = await read.http.getJson(
    {
      sourceId: SEC_DATA_ID,
      path: `/api/xbrl/companyfacts/CIK${cik}.json`,
      credential: SEC_CREDENTIAL,
      businessMissStatuses: BUSINESS_MISS_STATUSES,
      maxBytes: COMPANY_FACTS_MAXIMUM_BYTES,
      signal: read.signal,
    },
    (raw) => toCompanyFiling(cik, COMPANY_FACTS.parse(raw).facts)
  )

  return outcome.kind === 'ok' ? outcome.value : undefined
}

/** A filer that changed its reporting currency files the old years in the old one: the currency of
 *  its newest year is read, and years filed in another are left out rather than mixed in. */
function toCompanyFiling(
  cik: string,
  facts: Readonly<Record<string, Readonly<Record<string, unknown>>>>
): CompanyFiling | undefined {
  const concepts = COMPANY_FACT_TAXONOMIES.find((entry) => facts[entry.taxonomy] !== undefined)

  if (concepts === undefined) {
    return undefined
  }

  const histories = historiesOf(concepts, facts[concepts.taxonomy] ?? {})
  const filings = currenciesOf(histories).map((currency) => ({
    currency,
    answers: answersOf(cik, histories, conceptJobs(concepts, currency)),
  }))

  const dated = filings.flatMap((filing) => {
    const newest = newestEnd(filing)

    return newest === undefined ? [] : [{ filing, newest }]
  })

  return dated.toSorted((left, right) => right.newest.localeCompare(left.newest))[0]?.filing
}

function historiesOf(
  concepts: TaxonomyConcepts,
  filed: Readonly<Record<string, unknown>>
): ConceptHistories {
  const tags = [...concepts.flows, ...concepts.instants].flatMap((concept) => concept.tags)

  return new Map(
    tags.flatMap((tag) => (filed[tag] === undefined ? [] : [[tag, CONCEPT.parse(filed[tag])]]))
  )
}

function currenciesOf(histories: ConceptHistories): readonly CurrencyCode[] {
  const units = [...histories.values()].flatMap((history) => Object.keys(history.units))

  return [...new Set(units)].filter(isCurrencyCode)
}

function answersOf(
  cik: string,
  histories: ConceptHistories,
  jobs: readonly ConceptJob[]
): readonly FrameAnswer[] {
  return jobs.map((job) => {
    const history = histories.get(job.job.tag)

    return {
      job: job.job,
      facts: history === undefined ? [] : annualConceptFacts(history, { cik, job }),
    }
  })
}

function newestEnd(filing: CompanyFiling): string | undefined {
  const ends = filing.answers.flatMap((answer) => answer.facts.map((fact) => fact.end))

  return ends.length === 0 ? undefined : ends.reduce((left, right) => (right > left ? right : left))
}
