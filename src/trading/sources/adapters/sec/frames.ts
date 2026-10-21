import { z } from 'zod'

import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type {
  AccountLines,
  AnnualAccounts,
  FiledAccounts,
} from '@/trading/kernel/market/annual-accounts'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { FrameAnswer, FrameFact, FrameJob } from '@/trading/sources/adapters/sec/frame-jobs'
import type { SecTickerMap, TickerMapReader } from '@/trading/sources/adapters/sec/tickers'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { RowTarget } from '@/trading/sources/rows/row-target'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { MS_PER_DAY } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'
import { SEC_CREDENTIAL, SEC_DATA_ID, toPaddedCik } from '@/trading/sources/adapters/sec/client'
import { FLOW_CONCEPTS, INSTANT_CONCEPTS } from '@/trading/sources/adapters/sec/concepts'
import {
  BUSINESS_MISS_STATUSES,
  FRAME_CONCURRENCY,
  fiscalYearOf,
  sharesJob,
  usGaapJob,
} from '@/trading/sources/adapters/sec/frame-jobs'
import { recoverGaps } from '@/trading/sources/adapters/sec/gap-recovery'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  parseRow,
  utcDayOf,
  utcDayStartEpochMs,
  yearOf,
} from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

/** Fiscal years read back from the asked day: six reported ones, which a five-year trend needs
 *  (the base year and five after it), plus the year still in progress. */
const FRAME_YEARS = 7

/** A balance sheet is dated where the fiscal year ends, which can be any month, and an instant frame
 *  holds one calendar quarter's end: all four are read so every year end has its own. */
const INSTANT_QUARTERS = Object.freeze([1, 2, 3, 4])

/** A 10-K is due within 60 to 90 days of the year end; the frames carry no filing date, so the
 *  report counts as published at the latest of them. */
const ANNUAL_FILING_DAYS = 90

const FRAME = z.object({ data: z.array(z.unknown()) })

const FACT = z.object({ cik: z.number(), end: z.string(), val: z.number() })

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
  const framed = toAnnual(facts, wanted, target)
  const recovered = await recoverGaps({ http, signal }, wanted, framed)

  return {
    kind: 'ok',
    fetchedAt: map.fetchedAt,
    value: parsedSource({
      annual: recovered.length === 0 ? framed : toAnnual([...facts, ...recovered], wanted, target),
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
  return INSTANT_QUARTERS.flatMap((quarter) =>
    INSTANT_CONCEPTS.flatMap((concept) =>
      concept.tags.map((tag, priority) => ({
        ...usGaapJob({ line: concept.line, tag, priority }, `CY${year}Q${quarter}I`),
        atYearEnd: true as const,
      }))
    )
  )
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

interface YearAccumulator {
  readonly lines: { -readonly [K in keyof AccountLines]?: number }
  readonly priorities: Partial<Record<keyof AccountLines, number>>
  end?: TradingDay
}

/** A flow fixes the fiscal year (the year its period ends in), so flows are read first; a balance
 *  sheet then joins only the year whose flows close on its date, never a later quarter's. The cover
 *  share count joins the year of its frame. A line from an earlier-listed tag outranks a later one. */
function toAnnual(
  answers: readonly FrameAnswer[],
  wanted: ReadonlyMap<string, readonly Ticker[]>,
  target: RowTarget
): readonly AnnualAccounts[] {
  const years = new Map<string, YearAccumulator>()
  const ordered = [
    ...answers.filter((answer) => answer.job.atYearEnd !== true),
    ...answers.filter((answer) => answer.job.atYearEnd === true),
  ]

  for (const { job, facts } of ordered) {
    for (const fact of facts) {
      addFact(years, job, fact)
    }
  }

  return [...years].flatMap(([key, entry]) => toRows(key, entry, { wanted, target }))
}

function addFact(years: Map<string, YearAccumulator>, job: FrameJob, fact: FrameFact): void {
  const key = `${fact.cik}|${job.instantYear ?? fiscalYearOf(fact.end)}`
  const entry = years.get(key) ?? { lines: {}, priorities: {} }
  const held = entry.priorities[job.line]

  if (job.atYearEnd === true && entry.end !== fact.end) {
    return
  }

  if (held === undefined || job.priority < held) {
    entry.lines[job.line] = fact.value
    entry.priorities[job.line] = job.priority
  }

  if (job.instantYear === undefined && job.atYearEnd !== true) {
    entry.end = entry.end === undefined || fact.end > entry.end ? fact.end : entry.end
  }

  years.set(key, entry)
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
