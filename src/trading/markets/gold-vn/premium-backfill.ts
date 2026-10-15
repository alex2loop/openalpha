import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, FxRatePoint, GoldBoardPoint } from '@/trading/kernel/market/market-data'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type {
  MarketDataRefreshRequest,
  MarketManifest,
  TradingCalendar,
} from '@/trading/markets/types'
import { fxPair } from '@/trading/kernel/instrument'
import { provenanceOf } from '@/trading/kernel/source/source-result'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { WORLD_GOLD_REF } from '@/trading/markets/gold/api'
import { isSameTradingWindow, worldBars } from '@/trading/markets/gold-vn/board'
import {
  FX_LAG_SESSIONS,
  GOLD_VN_MARKET_REF,
  GOLD_VN_PREMIUM_WINDOW_DAYS,
  PREFERRED_FORMS,
  USD_VND,
  WORLD_CLOSE_LAG_SESSIONS,
} from '@/trading/markets/gold-vn/policy'
import { GOLD_VN_PREMIUM_SERIES, selectForm } from '@/trading/markets/gold-vn/premium'
import { assembleGoldBoard } from '@/trading/sources/rows/gold-board'

export interface PremiumBackfillDeps {
  readonly deps: MarketDeps
  readonly calendar: TradingCalendar
  readonly manifest: MarketManifest
}

/** What one writing pass did, so the live write and the backfill merge into a single reported row
 *  instead of each inventing a status for the same series. */
export interface PremiumPass {
  readonly written: readonly TradingDay[]
  /** Days no point could be computed for that a later pass may still fill: an operand leg that did
   *  not arrive, or one too far from the day to price it. */
  readonly missing: readonly TradingDay[]
  /** Days the counter published nothing on. No retry fills them, so a shortfall counted against
   *  them never clears; a vendor that stops publishing altogether is caught by the percentile's
   *  coverage floor rather than here. */
  readonly unpublished: readonly TradingDay[]
  readonly attempted: number
  /** The operands never arrived, so nothing was computable — distinct from arriving and leaving
   *  some days unfillable, which is a complete series with holes rather than a failed fetch. */
  readonly fetchFailed: boolean
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

const EMPTY_PREMIUM_PASS: PremiumPass = Object.freeze({
  written: Object.freeze([]),
  missing: Object.freeze([]),
  unpublished: Object.freeze([]),
  attempted: 0,
  fetchFailed: false,
  provenance: Object.freeze([]),
  caveats: Object.freeze([]),
})

interface DaySpan {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

interface Operands {
  readonly boards: ReadonlyMap<TradingDay, readonly GoldBoardPoint[]>
  /** The span the history actually carried, so a day with no board inside it can be told from one
   *  the fetch never reached. Absent when the history carried no rows at all. */
  readonly covered?: DaySpan
  /** Oldest first, as `bars` and `fxHistory` both publish them. */
  readonly world: readonly Candle[]
  readonly fx: readonly FxRatePoint[]
  readonly sourceId: SourceId
  readonly fetchedAt: number
}

/** What `readOperands` answers: the operands when all three legs arrived, and either way the
 *  provenance and caveats of the attempt — a refusal that names no source cannot be acted on. */
interface OperandRead {
  readonly operands: Operands | null
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

/** Fills the percentile window's days that no pass ever caught. The live board is only written by a
 *  run that happens after the counter settles, so without this the series holds the handful of
 *  evenings someone happened to refresh. */
export async function backfillPremium(
  input: PremiumBackfillDeps,
  request: MarketDataRefreshRequest
): Promise<PremiumPass> {
  const toDay = resolveSettledDay(input.calendar, request.now)
  const fromDay = input.calendar.addTradingDays(toDay, -GOLD_VN_PREMIUM_WINDOW_DAYS)
  const window = { fromDay, toDay }
  const wanted = await missingDays(input, request, window)

  if (wanted.length === 0) {
    return EMPTY_PREMIUM_PASS
  }

  const read = await readOperands(input, request, window)
  const { operands } = read

  if (operands === null) {
    return {
      ...EMPTY_PREMIUM_PASS,
      missing: wanted,
      attempted: wanted.length,
      fetchFailed: true,
      provenance: read.provenance,
      caveats: read.caveats,
    }
  }

  const written: TradingDay[] = []
  const missing: TradingDay[] = []
  const unpublished: TradingDay[] = []

  for (const day of wanted) {
    const premium = premiumOn(input, operands, day)

    if (premium !== undefined) {
      // `wanted` held only days the store lacked, so a refusal means another pass got there first.
      const stored = await input.deps.marketDataStore.upsertSeriesPoint({
        seriesId: GOLD_VN_PREMIUM_SERIES,
        day,
        value: premium,
        replace: request.forced,
        now: request.now,
        signal: request.signal,
      })

      if (stored) {
        written.push(day)
      }

      continue
    }

    if (isUnpublished(operands, day)) {
      unpublished.push(day)
      continue
    }

    missing.push(day)
  }

  return {
    written,
    missing,
    unpublished,
    attempted: wanted.length,
    fetchFailed: false,
    provenance: read.provenance,
    caveats: read.caveats,
  }
}

/** The window's trading days with no stored point, oldest first. One store read rather than one per
 *  day: the window is the percentile's, which runs to a hundred sessions. */
async function missingDays(
  input: PremiumBackfillDeps,
  request: MarketDataRefreshRequest,
  window: DaySpan
): Promise<readonly TradingDay[]> {
  const stored = await input.deps.marketDataStore.listSeriesPoints({
    seriesId: GOLD_VN_PREMIUM_SERIES,
    fromDay: window.fromDay,
    toDay: window.toDay,
    signal: request.signal,
  })
  const have = new Set(stored.map((point) => point.day))

  return windowDays(input.calendar, window.fromDay).filter((day) => !have.has(day))
}

/** Built by count rather than walked to a bound, so the list is bounded by construction and no loop
 *  invariant has to be trusted. */
function windowDays(calendar: TradingCalendar, fromDay: TradingDay): readonly TradingDay[] {
  return Array.from({ length: GOLD_VN_PREMIUM_WINDOW_DAYS + 1 }, (_, index) =>
    calendar.addTradingDays(fromDay, index)
  )
}

/** All three legs and the stamp that dates them, or none: a premium is a domestic board priced
 *  against a world close at a rate, and a missing leg makes the other two unusable rather than
 *  approximate. */
async function readOperands(
  input: PremiumBackfillDeps,
  request: MarketDataRefreshRequest,
  window: DaySpan
): Promise<OperandRead> {
  const [history, world, fx] = await Promise.all([
    readBoardHistory(input, request, window),
    // The same count in the world's five-session week spans more calendar days than the counter's
    // six, so it holds every world close the window's days can price against.
    worldBars(input.deps, {
      instrument: WORLD_GOLD_REF,
      asOf: window.toDay,
      now: request.now,
      sessions: GOLD_VN_PREMIUM_WINDOW_DAYS,
      signal: request.signal,
    }),
    input.deps.sources.resolve({
      kind: 'fxHistory',
      context: {
        ticker: fxPair(USD_VND.fromCurrency, USD_VND.toCurrency),
        fromDay: window.fromDay,
        toDay: window.toDay,
      },
      signal: request.signal,
    }),
  ])
  const historyProvenance = provenanceOf(history)
  const provenance = [...historyProvenance, ...provenanceOf(world), ...provenanceOf(fx)]
  const caveats = [...history.caveats, ...world.caveats, ...fx.caveats]
  const [stamp] = historyProvenance

  if (
    history.kind !== 'available' ||
    world.kind !== 'available' ||
    fx.kind !== 'available' ||
    stamp === undefined
  ) {
    return { operands: null, provenance, caveats }
  }

  const boards = groupByDay(history.value)
  const covered = coveredSpan(boards)

  return {
    operands: {
      boards,
      ...(covered === undefined ? {} : { covered }),
      world: world.value,
      fx: fx.value,
      sourceId: stamp.sourceId,
      fetchedAt: stamp.fetchedAt,
    },
    provenance,
    caveats,
  }
}

/** The window travels with the request: a provider that counts back from today has no other way to
 *  know how far the percentile reaches. */
function readBoardHistory(
  input: PremiumBackfillDeps,
  request: MarketDataRefreshRequest,
  window: DaySpan
): Promise<SourceResult<readonly GoldBoardPoint[]>> {
  return input.deps.sources.resolve({
    kind: 'goldBoardHistory',
    context: {
      market: GOLD_VN_MARKET_REF,
      region: input.manifest.region,
      fromDay: window.fromDay,
      toDay: window.toDay,
    },
    signal: request.signal,
  })
}

/** Bounded by the parser's own point cap, so this map cannot grow with the page. */
function groupByDay(
  points: readonly GoldBoardPoint[]
): ReadonlyMap<TradingDay, readonly GoldBoardPoint[]> {
  const byDay = new Map<TradingDay, GoldBoardPoint[]>()

  for (const point of points) {
    const rows = byDay.get(point.day)

    if (rows === undefined) {
      byDay.set(point.day, [point])
      continue
    }

    rows.push(point)
  }

  return byDay
}

/** Oldest and newest day the history carried. Absent on an empty history, where no day can be
 *  called unpublished rather than unfetched. */
function coveredSpan(
  boards: ReadonlyMap<TradingDay, readonly GoldBoardPoint[]>
): DaySpan | undefined {
  const days = [...boards.keys()].sort()
  const fromDay = days[0]
  const toDay = days[days.length - 1]

  if (fromDay === undefined || toDay === undefined) {
    return undefined
  }

  return { fromDay, toDay }
}

/** A day the history reached and found no board on: the counter published nothing. A day outside
 *  the span is one this fetch never covered, which a later one may. */
function isUnpublished(operands: Operands, day: TradingDay): boolean {
  const { covered } = operands

  if (covered === undefined || operands.boards.has(day)) {
    return false
  }

  return day >= covered.fromDay && day <= covered.toDay
}

/** `selectForm` computes every premium in this market; this only assembles the day's operands and
 *  refuses the ones the lag rules place too far from it. */
function premiumOn(
  input: PremiumBackfillDeps,
  operands: Operands,
  day: TradingDay
): number | undefined {
  const rows = operands.boards.get(day)
  // The world close before the day, never its own: COMEX settles hours after the counters close,
  // so a day filled that evening could only have priced off the day before, and a day filled later
  // must be measured the same way or the window ranks one convention against the other.
  const close = newestWhere(operands.world, (candle) => candle.at < day)
  const rate = newestWhere(operands.fx, (point) => point.day <= day)

  if (rows === undefined || close === undefined || rate === undefined) {
    return undefined
  }

  if (
    !(
      isSameTradingWindow(input.calendar, [close.at, day], WORLD_CLOSE_LAG_SESSIONS) &&
      isSameTradingWindow(input.calendar, [rate.day, day], FX_LAG_SESSIONS)
    )
  ) {
    return undefined
  }

  const board = assembleGoldBoard(
    {
      sourceId: operands.sourceId,
      fetchedAt: operands.fetchedAt,
      observedAt: operands.fetchedAt,
      asOf: day,
    },
    rows
  )

  return selectForm({
    board,
    preferredForms: PREFERRED_FORMS,
    worldUsdPerOunce: close.close,
    usdVnd: rate.rate,
  })?.premium
}

/** Both operand series arrive oldest first, so the last eligible row is the newest. */
function newestWhere<T>(rows: readonly T[], isEligible: (row: T) => boolean): T | undefined {
  let newest: T | undefined

  for (const row of rows) {
    if (!isEligible(row)) {
      break
    }

    newest = row
  }

  return newest
}
