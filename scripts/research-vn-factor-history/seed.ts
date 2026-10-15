import { z } from 'zod'

import type { Booted } from '@/app/api'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { BarRecord, FlowSnapshot } from '@/trading/kernel/market/market-data'
import type { TradingCalendar } from '@/trading/markets/types'
import { BROWSER_HEADERS } from '@/core/http-client'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { tradingDay } from '@/trading/kernel/instrument'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { quarterlyReportDeadline } from '@/trading/markets/disclosure-calendar'
import { VN_FLOW_SESSIONS, VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { VNDIRECT_DEFAULT_ENDPOINT } from '@/trading/sources/adapters/vndirect/client'
import {
  FUNDAMENTAL_RATIO_CODES,
  isPricedRatio,
  toFundamentals,
} from '@/trading/sources/adapters/vndirect/fundamentals'

/** One code's whole history in one page: offset paging over these endpoints drops rows. */
const PAGE_SIZE = 10_000
/** Calendar days of filings read before the first board, so its newest quarter is in hand. */
const FISCAL_LOOKBACK_DAYS = 400
const SEED_CONCURRENCY = 4
const REQUEST_TIMEOUT_MS = 30_000
/** The provider answers a burst with throttles and gateway errors; a dropped name is a hole in the
 *  history being measured, so those are retried with a doubling wait. */
const RETRY_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504])
const RETRY_ATTEMPTS = 4
const RETRY_BASE_MS = 2_000
const PROGRESS_EVERY = 100
const DAY_LENGTH = 10

const FILING_PAGE = z.object({
  totalElements: z.number(),
  data: z.array(z.object({ fiscalDate: z.string(), createdDate: z.string() })),
})
const RATIO_PAGE = z.object({
  totalElements: z.number(),
  data: z.array(
    z.object({ code: z.string(), reportDate: z.string(), ratioCode: z.string(), value: z.number() })
  ),
})

export interface SeedScope {
  readonly booted: Booted
  readonly calendar: TradingCalendar
  readonly names: readonly InstrumentRef[]
  /** The first session the stored series already holds; seeding fills everything before it. */
  readonly storedFrom: TradingDay
  readonly historyFrom: TradingDay
  readonly boards: readonly TradingDay[]
}

interface HistoryRead {
  readonly code: string
  readonly range: { readonly fromDay: TradingDay; readonly toDay: TradingDay }
  readonly signal: AbortSignal
}

type RatioRow = z.infer<typeof RATIO_PAGE>['data'][number]

/** The provider's adjusted series for every name and the index, written through the same store
 *  write a refresh uses, for the sessions before the stored window. */
export async function seedBars(scope: SeedScope): Promise<void> {
  const { app } = scope.booted
  const { marketData } = app.resolve('tradingServices')
  const store = app.resolve('tradingStores').marketData
  const toDay = scope.calendar.addTradingDays(scope.storedFrom, -1)
  const now = Date.now()
  let done = 0
  let missed = 0

  await mapWithConcurrency(scope.names, SEED_CONCURRENCY, async (instrument) => {
    const result = await marketData.bars({
      ticker: instrument.ticker,
      market: VN_MARKET_REF,
      fromDay: scope.historyFrom,
      toDay,
      now,
      signal: app.signal,
    })
    const stamp = result.kind === 'available' ? result.provenance[0] : undefined

    if (stamp === undefined) {
      missed += 1
    }

    if (result.kind === 'available' && stamp !== undefined) {
      const records = result.value.map(
        (candle): BarRecord => ({ instrument, candle, ...stampOf(stamp, candle.turnover) })
      )

      await store.upsertBars({
        market: VN_MARKET_REF,
        fromDay: scope.historyFrom,
        toDay,
        records,
        signal: app.signal,
      })
    }

    done += 1
    progress('bars', done, scope.names.length)
  })

  process.stderr.write(`bars: ${missed} names answered no history\n`)
}

function stampOf(
  stamp: { readonly sourceId: BarRecord['sourceId']; readonly fetchedAt: number },
  turnover: number | undefined
): Pick<BarRecord, 'sourceId' | 'fetchedAt' | 'turnover'> {
  return {
    sourceId: stamp.sourceId,
    fetchedAt: stamp.fetchedAt,
    ...(turnover === undefined ? {} : { turnover }),
  }
}

/** One snapshot per name per board before the stored snapshots, as known on that board: each priced
 *  ratio at its newest session, each filed ratio from the newest quarter filed by then. The screen
 *  reads the newest snapshot however old, so a board left out is scored on stale ratios. */
export async function seedFundamentals(
  scope: SeedScope,
  storedFundamentalsFrom: TradingDay
): Promise<void> {
  const { app } = scope.booted
  const store = app.resolve('tradingStores').marketData
  const boards = scope.boards.filter((day) => day < storedFundamentalsFrom)
  const first = boards[0]
  const last = boards.at(-1)

  if (first === undefined || last === undefined) {
    return
  }

  const range = { fromDay: shiftCalendarDay(first, -FISCAL_LOOKBACK_DAYS), toDay: last }
  const fetchedAt = Date.now()
  let done = 0

  await mapWithConcurrency(scope.names, SEED_CONCURRENCY, async (instrument) => {
    const read = { code: instrument.ticker, range, signal: app.signal }
    const [rows, filed] = await Promise.all([ratioHistory(read), filingDays(read)])
    const snapshots = boards.flatMap((day) =>
      toFundamentalsOrEmpty(rowsAsOf(rows, { day, filed }), fetchedAt)
    )

    if (snapshots.length > 0) {
      await store.upsertFundamentals(snapshots, app.signal)
    }

    done += 1
    progress('fundamentals', done, scope.names.length)
  })
}

function toFundamentalsOrEmpty(
  rows: readonly RatioRow[],
  fetchedAt: number
): ReturnType<typeof toFundamentals> {
  return rows.length === 0 ? [] : toFundamentals(rows, { market: VN_MARKET_REF, fetchedAt })
}

function rowsAsOf(
  rows: readonly RatioRow[],
  at: { readonly day: TradingDay; readonly filed: ReadonlyMap<string, TradingDay> }
): readonly RatioRow[] {
  const newest = new Map<string, RatioRow>()

  for (const row of rows) {
    const known = isPricedRatio(row.ratioCode)
      ? row.reportDate <= at.day
      : availableOn(row, at.filed) <= at.day
    const held = newest.get(row.ratioCode)

    if (known && (held === undefined || row.reportDate > held.reportDate)) {
      newest.set(row.ratioCode, row)
    }
  }

  return [...newest.values()]
}

function availableOn(row: RatioRow, filed: ReadonlyMap<string, TradingDay>): TradingDay {
  const day = tradingDay(row.reportDate)

  return filed.get(day) ?? quarterlyReportDeadline(day)
}

async function ratioHistory(read: HistoryRead): Promise<readonly RatioRow[]> {
  const { code, range, signal } = read
  const body = RATIO_PAGE.parse(
    await readPage('ratios', {
      q: `code:${code}~ratioCode:${FUNDAMENTAL_RATIO_CODES.join(',')}~reportDate:gte:${range.fromDay}~reportDate:lte:${range.toDay}`,
      sort: 'reportDate:asc,ratioCode:asc',
      signal,
    })
  )

  assertOnePage(code, body.totalElements)

  return body.data
}

/** The day each quarter was first filed, keyed by period end: a statement row keeps its first
 *  `createdDate` through later revisions. */
async function filingDays(read: HistoryRead): Promise<ReadonlyMap<string, TradingDay>> {
  const { code, range, signal } = read
  const body = FILING_PAGE.parse(
    await readPage('financial_statements', {
      q: `code:${code}~reportType:QUARTER~fiscalDate:gte:${range.fromDay}~fiscalDate:lte:${range.toDay}`,
      fields: 'fiscalDate,createdDate',
      signal,
    })
  )

  assertOnePage(code, body.totalElements)

  const days = new Map<string, TradingDay>()

  for (const row of body.data) {
    const created = tradingDay(row.createdDate.slice(0, DAY_LENGTH))
    const held = days.get(row.fiscalDate)

    if (held === undefined || created < held) {
      days.set(row.fiscalDate, created)
    }
  }

  return days
}

async function readPage(
  resource: string,
  params: {
    readonly q: string
    readonly sort?: string
    readonly fields?: string
    readonly signal: AbortSignal
  }
): Promise<unknown> {
  const { signal, ...query } = params
  const search = new URLSearchParams({ ...query, size: String(PAGE_SIZE) })

  return await fetchJson(`${VNDIRECT_DEFAULT_ENDPOINT}/v4/${resource}?${search}`, signal)
}

function assertOnePage(code: string, totalElements: number): void {
  if (totalElements > PAGE_SIZE) {
    throw new Error(`${code}: ${totalElements} rows exceed one page`)
  }
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    })

    if (response.ok) {
      return await response.json()
    }

    if (!RETRY_STATUSES.has(response.status) || attempt >= RETRY_ATTEMPTS) {
      throw new Error(`${url} answered ${response.status} after ${attempt} attempt(s)`)
    }

    await Bun.sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
  }
}

/** Foreign and proprietary flows for the sessions the stored flows do not reach, one window of the
 *  live read at a time: every name slices the one market-wide read of that window. */
export async function seedFlows(scope: SeedScope, storedFlowsFrom: TradingDay): Promise<void> {
  const { app } = scope.booted
  const { marketData } = app.resolve('tradingServices')
  const store = app.resolve('tradingStores').marketData
  const first = scope.boards[0]

  if (first === undefined) {
    return
  }

  const now = Date.now()
  let toDay = scope.calendar.addTradingDays(first, -VN_FLOW_SESSIONS)
  let missed = 0

  while (toDay < storedFlowsFrom) {
    const fromDay = scope.calendar.addTradingDays(toDay, -VN_FLOW_SESSIONS)
    const flows = await mapWithConcurrency(scope.names, SEED_CONCURRENCY, async (instrument) => {
      const result = await marketData.flows({
        ticker: instrument.ticker,
        market: VN_MARKET_REF,
        fromDay,
        toDay,
        now,
        signal: app.signal,
      })

      if (result.kind !== 'available') {
        missed += 1
      }

      return result.kind === 'available' ? result.value : []
    })

    const fresh = flows.flat().filter((flow: FlowSnapshot) => flow.at < storedFlowsFrom)

    await store.upsertFlows(fresh, app.signal)
    process.stderr.write(`flows through ${toDay}\n`)
    toDay = scope.calendar.addTradingDays(toDay, VN_FLOW_SESSIONS)
  }

  process.stderr.write(`flows: ${missed} name-windows answered nothing\n`)
}

function progress(label: string, done: number, total: number): void {
  if (done % PROGRESS_EVERY === 0 || done === total) {
    process.stderr.write(`${label} ${done}/${total}\n`)
  }
}
