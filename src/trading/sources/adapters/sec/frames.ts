import { z } from 'zod'

import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type {
  AccountLines,
  AnnualAccounts,
  FiledAccounts,
} from '@/trading/kernel/market/annual-accounts'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SecTickerMap, TickerMapReader } from '@/trading/sources/adapters/sec/tickers'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { RowTarget } from '@/trading/sources/rows/row-target'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { MS_PER_DAY } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'
import { SEC_CREDENTIAL, SEC_DATA_ID, toPaddedCik } from '@/trading/sources/adapters/sec/client'
import {
  FLOW_CONCEPTS,
  INSTANT_CONCEPTS,
  SHARES_CONCEPT,
} from '@/trading/sources/adapters/sec/concepts'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  parseRow,
  utcDayOf,
  utcDayStartEpochMs,
  yearOf,
} from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

/** Fiscal years read back from the asked day: five reported ones, plus the year still in progress. */
const FRAME_YEARS = 6
/** A 10-K is due within 60 to 90 days of the year end; the frames carry no filing date, so the
 *  report counts as published at the latest of them. */
const ANNUAL_FILING_DAYS = 90
const FRAME_CONCURRENCY = 4
const FISCAL_YEAR_GRACE_DAYS = 7
/** A frame that does not exist yet (a year not reported) is a business miss, not an outage. */
const BUSINESS_MISS_STATUSES = Object.freeze([404])

const FRAME = z.object({ data: z.array(z.unknown()) })
const FACT = z.object({ cik: z.number(), end: z.string(), val: z.number() })

interface FrameFact {
  readonly cik: string
  readonly end: TradingDay
  readonly value: number
}

interface FrameJob {
  readonly taxonomy: string
  readonly tag: string
  readonly unit: 'USD' | 'shares'
  readonly period: string
  /** Where the answer lands: a line, and the year an instant frame is filed under. */
  readonly line: keyof AccountLines
  readonly instantYear?: number
  readonly priority: number
}

interface FrameAnswer {
  readonly job: FrameJob
  readonly facts: readonly FrameFact[]
}

export function secAccountsSource(
  options: SourceAdapterOptions,
  readTickers: TickerMapReader
): RegisteredSource {
  return createSource({
    id: SEC_DATA_ID,
    kind: 'accounts',
    http: options.http,
    covers: (context) =>
      context.instrument === undefined &&
      context.tickers !== undefined &&
      context.toDay !== undefined,
    load: async (context, signal) => {
      const map = await readTickers(signal)

      return map.kind === 'error' ? map : loadAccounts({ http: options.http, context, map, signal })
    },
  })
}

interface AccountsRead {
  readonly http: SourceHttp
  readonly context: SourceContext
  readonly map: { readonly value: SecTickerMap; readonly fetchedAt: number }
  readonly signal: AbortSignal
}

async function loadAccounts(
  read: AccountsRead
): Promise<SourceFetchOutcome<ParsedSource<FiledAccounts>>> {
  const { http, context, map, signal } = read
  const { toDay } = context

  if (toDay === undefined) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const wanted = wantedByCik(context.tickers ?? [], map.value)
  const answers = await mapWithConcurrency(framesFor(yearOf(toDay)), FRAME_CONCURRENCY, (job) =>
    readFrame({ http, wanted, signal }, job)
  )
  const failed = answers.find((answer) => answer.kind === 'error')

  if (failed?.kind === 'error') {
    return failed
  }

  const facts = answers.flatMap((answer) => (answer.kind === 'ok' ? [answer.value] : []))
  const target = resolveRowTarget(context, map.fetchedAt)

  return {
    kind: 'ok',
    fetchedAt: map.fetchedAt,
    value: parsedSource({
      annual: toAnnual(facts, wanted, target),
      quarters: [],
    }),
  }
}

/** One company id can carry several tickers (the two Alphabet classes): each gets the same report. */
function wantedByCik(
  tickers: readonly Ticker[],
  map: SecTickerMap
): ReadonlyMap<string, readonly Ticker[]> {
  const wanted = new Map<string, Ticker[]>()

  for (const code of tickers) {
    const cik = map.get(code)

    if (cik !== undefined) {
      wanted.set(cik, [...(wanted.get(cik) ?? []), code])
    }
  }

  return wanted
}

function framesFor(toYear: number): readonly FrameJob[] {
  const years = Array.from({ length: FRAME_YEARS }, (_, index) => toYear - FRAME_YEARS + 1 + index)

  return years.flatMap((year) => [...flowJobs(year), ...instantJobs(year), sharesJob(year)])
}

function flowJobs(year: number): readonly FrameJob[] {
  return FLOW_CONCEPTS.flatMap((concept) =>
    concept.tags.map((tag, priority) =>
      usGaapJob({ line: concept.line, tag, priority }, `CY${year}`)
    )
  )
}

function instantJobs(year: number): readonly FrameJob[] {
  return INSTANT_CONCEPTS.flatMap((concept) =>
    concept.tags.map((tag, priority) => ({
      ...usGaapJob({ line: concept.line, tag, priority }, `CY${year}Q4I`),
      instantYear: year,
    }))
  )
}

function sharesJob(year: number): FrameJob {
  return {
    taxonomy: SHARES_CONCEPT.taxonomy,
    tag: SHARES_CONCEPT.tag,
    unit: 'shares',
    period: `CY${year}Q4I`,
    line: 'sharesOutstanding',
    instantYear: year,
    priority: 0,
  }
}

function usGaapJob(
  concept: { readonly line: keyof AccountLines; readonly tag: string; readonly priority: number },
  period: string
): FrameJob {
  return { taxonomy: 'us-gaap', unit: 'USD', period, ...concept }
}

/** A miss is an empty frame: the year is simply not there yet. */
async function readFrame(
  read: {
    readonly http: SourceHttp
    readonly wanted: ReadonlyMap<string, readonly Ticker[]>
    readonly signal: AbortSignal
  },
  job: FrameJob
): Promise<SourceFetchOutcome<FrameAnswer>> {
  const { http, wanted, signal } = read
  const outcome = await http.getJson(
    {
      sourceId: SEC_DATA_ID,
      path: `/api/xbrl/frames/${job.taxonomy}/${job.tag}/${job.unit}/${job.period}.json`,
      credential: SEC_CREDENTIAL,
      businessMissStatuses: BUSINESS_MISS_STATUSES,
      signal,
    },
    (raw) => ({ job, facts: toFacts(raw, wanted) })
  )

  return outcome.kind === 'error' && outcome.code === 'source.symbol-not-found'
    ? { kind: 'ok', value: { job, facts: [] }, fetchedAt: 0 }
    : outcome
}

function toFacts(raw: unknown, wanted: ReadonlyMap<string, readonly Ticker[]>): FrameFact[] {
  return dropInvalid(FRAME.parse(raw).data, (row) => {
    const fact = parseRow(FACT, row, 'sec fact')

    return { cik: toPaddedCik(fact.cik), end: tradingDay(fact.end), value: fact.val }
  }).filter((fact) => wanted.has(fact.cik))
}

/** The year a period ending on `end` belongs to. A 52/53-week filer's year can end in the first days
 *  of January (Harris's 2024 ended 2025-01-03), and keyed by the calendar year of that date it
 *  collides with the next year's and leaves a hole behind it. A week back keeps those with the
 *  year they close, and moves no filer whose year ends later in the month. */
function fiscalYearOf(end: TradingDay): number {
  return yearOf(utcDayOf(utcDayStartEpochMs(end) - FISCAL_YEAR_GRACE_DAYS * MS_PER_DAY))
}

interface YearAccumulator {
  readonly lines: { -readonly [K in keyof AccountLines]?: number }
  readonly priorities: Partial<Record<keyof AccountLines, number>>
  end?: TradingDay
}

/** A flow fixes the fiscal year (the year its period ends in); an instant joins the year of the
 *  frame it came from. A line from an earlier-listed tag outranks a later one. */
function toAnnual(
  answers: readonly FrameAnswer[],
  wanted: ReadonlyMap<string, readonly Ticker[]>,
  target: RowTarget
): readonly AnnualAccounts[] {
  const years = new Map<string, YearAccumulator>()

  for (const { job, facts } of answers) {
    for (const fact of facts) {
      const year = job.instantYear ?? fiscalYearOf(fact.end)
      const key = `${fact.cik}|${year}`
      const entry = years.get(key) ?? { lines: {}, priorities: {} }
      const held = entry.priorities[job.line]

      if (held === undefined || job.priority < held) {
        entry.lines[job.line] = fact.value
        entry.priorities[job.line] = job.priority
      }

      if (job.instantYear === undefined && (entry.end === undefined || fact.end > entry.end)) {
        entry.end = fact.end
      }

      years.set(key, entry)
    }
  }

  return [...years].flatMap(([key, entry]) => toRows(key, entry, { wanted, target }))
}

function toRows(
  key: string,
  entry: YearAccumulator,
  context: { readonly wanted: ReadonlyMap<string, readonly Ticker[]>; readonly target: RowTarget }
): readonly AnnualAccounts[] {
  const { wanted, target } = context
  const [cik = '', year = ''] = key.split('|')

  // A year with only balance-sheet instants has no report to speak of: the flows define it.
  if (entry.end === undefined) {
    return []
  }

  const publishedOn = tradingDay(
    utcDayOf(utcDayStartEpochMs(entry.end) + ANNUAL_FILING_DAYS * MS_PER_DAY)
  )

  return (wanted.get(cik) ?? []).map((code) => ({
    instrument: { market: target.market, ticker: code },
    fiscalYear: Number(year),
    publishedOn,
    lines: entry.lines,
    sourceId: SEC_DATA_ID,
    fetchedAt: target.fetchedAt,
  }))
}
