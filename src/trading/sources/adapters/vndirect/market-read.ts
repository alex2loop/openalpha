// A refresh sweep asks this provider for one ticker at a time, hundreds of times, over the same
// window. `api-finfo` serves the whole market for a window in one query, so the first caller reads
// it and every later caller takes its slice — the per-instrument source seam is unchanged.
import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { SourceFetchOutcome, SourceHttp, SourceRequest } from '@/trading/sources/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { MS_PER_DAY, utcDay } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'
import { pageRows, utcDayStartEpochMs } from '@/trading/sources/rows/normalization'

/** Idle window: slides forward on every hit so a sweep spanning more than one window still reuses
 *  its single read. */
const MARKET_READ_TTL_MS = 60_000

/** Ceiling the sliding window cannot pass. Without it a market whose sweeps never fall idle would
 *  serve one read for the rest of the session. */
const MARKET_READ_MAX_AGE_MS = 300_000

/** Day reads in flight at once once a window is split, under the provider's own pacing. */
const DAY_READ_CONCURRENCY = 4

/** Every market-wide row names its instrument in `code` and its session in a day field whose name
 *  is the only thing that differs per endpoint. The rest of the row is the caller's to validate. */
const MARKET_ROW = z.object({ code: z.string().min(1) }).catchall(z.unknown())

interface GroupedRead {
  readonly byTicker: ReadonlyMap<string, readonly unknown[]>
  /** Every day the read reported, for any ticker. */
  readonly days: ReadonlySet<string>
}

interface Slot {
  readonly key: string
  expiresAt: number
  hardExpiresAt: number
  readonly pass: Promise<SourceFetchOutcome<GroupedRead>>
  /** Whose read this is until it lands. A pass still in flight runs under the signal that started
   *  it, so one caller cancelling would fail every other caller waiting on it. */
  readonly signal: AbortSignal
  settled: boolean
}

interface DayWindow {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

interface MarketWindowRead {
  readonly http: SourceHttp
  readonly window: DayWindow
  /** Rows one request answers at most. */
  readonly pageSize: number
  request(window: DayWindow): SourceRequest
}

interface MarketReadRequest {
  readonly key: string
  readonly ticker: string
  readonly signal: AbortSignal
  load(): Promise<SourceFetchOutcome<readonly unknown[]>>
}

export interface MarketRead {
  /** One ticker's rows out of the shared read. A failed read is returned as the caller's own
   *  failure: a sweep shares one window, so falling back would turn one provider failure into one
   *  request per ticker aimed at a provider that is already unhappy. */
  forTicker(request: MarketReadRequest): Promise<SourceFetchOutcome<readonly unknown[]>>
  /** Which days the shared read covered at all, from the slot `forTicker` installed for `key`. An
   *  absent, failed, or expired read is an empty set, so a caller can never infer coverage it did
   *  not see. Lets a caller tell "reported nothing for this ticker" from "reported nothing". */
  coveredDays(key: string): Promise<ReadonlySet<string>>
}

/** A short page set is not a shorter answer here — every ticker slices this one read, so the rows
 *  the cap dropped are missing for the whole market at once and the caller would replace a full
 *  window with them. It fails like any other bad read, and the stored window stands. Its own code,
 *  not `source.truncated`: that one tells the reader it is holding a first slice, which is the
 *  opposite of what happened here. */
function toGroupedRead(
  outcome: SourceFetchOutcome<readonly unknown[]>,
  dayField: string
): SourceFetchOutcome<GroupedRead> {
  if (outcome.kind === 'error') {
    return outcome
  }

  if (outcome.truncated === true) {
    return { kind: 'error', code: 'source.market-read-truncated' }
  }

  return { ...outcome, value: groupByTicker(outcome.value, dayField) }
}

export function createMarketRead(dayField: string): MarketRead {
  // One slot rather than a cache: a second window doubles both the rows held and the market-wide
  // requests made. A read for a different key replaces it, which within a sweep never happens —
  // every ticker asks for the same window.
  let slot: Slot | null = null

  const start = (
    request: MarketReadRequest,
    now: number
  ): Promise<SourceFetchOutcome<GroupedRead>> => {
    // Only the entry this read installed is dropped; a newer window may already own the slot.
    const release = (): void => {
      if (slot?.pass === pass) {
        slot = null
      }
    }
    const pass: Promise<SourceFetchOutcome<GroupedRead>> = request.load().then(
      (outcome) => settle(slot, pass, toGroupedRead(outcome, dayField)),
      (err: unknown) => {
        release()
        throw err
      }
    )

    slot = {
      key: request.key,
      expiresAt: now + MARKET_READ_TTL_MS,
      hardExpiresAt: now + MARKET_READ_MAX_AGE_MS,
      pass,
      signal: request.signal,
      settled: false,
    }

    return pass
  }

  // Extends the idle window on every hit, up to the slot's hard ceiling.
  const liveSlot = (key: string, now: number): Slot | null => {
    if (slot === null || slot.key !== key || now >= slot.expiresAt || now >= slot.hardExpiresAt) {
      return null
    }

    slot.expiresAt = Math.min(now + MARKET_READ_TTL_MS, slot.hardExpiresAt)

    return slot
  }

  return {
    async forTicker(request) {
      const now = Date.now()
      const live = liveSlot(request.key, now)
      // A failed read stays in the slot for its term, so the sweep pays for one attempt rather than
      // retrying the whole market once per ticker. A read still in flight is joined only by the
      // caller that started it, whose cancellation is then the only one that can fail it.
      const joinable = live !== null && (live.settled || live.signal === request.signal)
      const outcome = await (joinable ? live.pass : start(request, now))

      return outcome.kind === 'error'
        ? outcome
        : { ...outcome, value: outcome.value.byTicker.get(request.ticker) ?? [] }
    },

    async coveredDays(key) {
      const live = liveSlot(key, Date.now())

      if (live === null) {
        return new Set()
      }

      const outcome = await live.pass

      return outcome.kind === 'error' ? new Set() : outcome.value.days
    },
  }
}

/** The whole market for a window, from pages that never continue one another. The provider pages
 *  by offset over an order it does not hold still, so a page set repeats some rows and silently
 *  drops as many others: measured 2026-10-12, one month of bars lost ~1,400 of 34,893 rows and of
 *  foreign flows ~550 of 41,747, a different set on every read. A single page is a consistent
 *  answer, so a window that fits one is read whole and one that does not is read a day at a time,
 *  since one session of the whole market fits a page. */
export async function readMarketWindow(
  read: MarketWindowRead
): Promise<SourceFetchOutcome<readonly unknown[]>> {
  const whole = await readPage(read, read.window)

  if (whole.kind === 'error' || whole.value.length < read.pageSize) {
    return whole
  }

  return await readDays(read)
}

/** One page per calendar day, a few in flight. Once a day fails or fills its page the rest are not
 *  asked: the whole read is already lost, and the provider is the one struggling. */
async function readDays(read: MarketWindowRead): Promise<SourceFetchOutcome<readonly unknown[]>> {
  let failure: SourceFetchOutcome<readonly unknown[]> | undefined
  const rows: unknown[] = []
  let fetchedAt = 0

  await mapWithConcurrency(daysOf(read.window), DAY_READ_CONCURRENCY, async (day) => {
    if (failure !== undefined) {
      return
    }

    const page = await readPage(read, { fromDay: day, toDay: day })

    if (page.kind === 'error') {
      failure ??= page
      return
    }

    // A day that fills its page is one the provider would continue on another.
    if (page.value.length >= read.pageSize) {
      failure ??= { kind: 'error', code: 'source.market-read-truncated' }
      return
    }

    rows.push(...page.value)
    fetchedAt = Math.max(fetchedAt, page.fetchedAt)
  })

  return failure ?? { kind: 'ok', value: rows, fetchedAt }
}

function readPage(
  read: MarketWindowRead,
  window: DayWindow
): Promise<SourceFetchOutcome<readonly unknown[]>> {
  return read.http.getJson(read.request(window), (raw) => pageRows(raw))
}

/** Every calendar day of the window: the provider answers a day it did not trade with no rows. */
function daysOf(window: DayWindow): readonly TradingDay[] {
  const days: TradingDay[] = []
  const last = utcDayStartEpochMs(window.toDay)

  for (let at = utcDayStartEpochMs(window.fromDay); at <= last; at += MS_PER_DAY) {
    days.push(tradingDay(utcDay(at)))
  }

  return days
}

/** Marks the slot this read installed as landed, if a newer window has not replaced it. A failed
 *  read's window runs from the failure, not the request (a slow page set may have spent that), and
 *  its ceiling is the same instant, so hits never slide it. */
function settle(
  slot: Slot | null,
  pass: Promise<SourceFetchOutcome<GroupedRead>>,
  outcome: SourceFetchOutcome<GroupedRead>
): SourceFetchOutcome<GroupedRead> {
  if (slot?.pass === pass) {
    slot.settled = true

    if (outcome.kind === 'error') {
      slot.expiresAt = Date.now() + MARKET_READ_TTL_MS
      slot.hardExpiresAt = slot.expiresAt
    }
  }

  return outcome
}

/** A provider that pages by offset can repeat a row across a page boundary. Keeping the repeat fails
 *  the admissibility guard that rejects an instrument for reporting one session twice; a row with
 *  no `(code, day)` belongs to no caller at all. */
function groupByTicker(rows: readonly unknown[], dayField: string): GroupedRead {
  const grouped = new Map<string, unknown[]>()
  const days = new Set<string>()
  const seen = new Set<string>()

  for (const row of rows) {
    const parsed = MARKET_ROW.safeParse(row)
    const day = parsed.data?.[dayField]

    if (parsed.data === undefined || typeof day !== 'string') {
      continue
    }

    const code = parsed.data.code
    const identity = `${code}|${day}`

    if (seen.has(identity)) {
      continue
    }

    seen.add(identity)
    days.add(day)

    const bucket = grouped.get(code)

    if (bucket === undefined) {
      grouped.set(code, [row])
      continue
    }

    bucket.push(row)
  }

  return { byTicker: grouped, days }
}
