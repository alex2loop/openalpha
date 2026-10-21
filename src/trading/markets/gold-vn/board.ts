import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay, VnGoldForm } from '@/trading/kernel/instrument'
import type { BarsRequest } from '@/trading/kernel/market/market-capability'
import type { Candle, FxQuote, GoldBoard } from '@/trading/kernel/market/market-data'
import type { SourceProvenance, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { FormSelection } from '@/trading/markets/gold-vn/premium'
import type { MarketManifest, TradingCalendar } from '@/trading/markets/types'
import { sourcedCaveat } from '@/trading/kernel/caveat'
import { region } from '@/trading/kernel/instrument'
import { available, provenanceOf, unavailable } from '@/trading/kernel/source/source-result'
import { createTradingCalendar, resolveSettledDay } from '@/trading/markets/calendar'
import {
  EVIDENCE_SESSIONS,
  GOLD_MARKET_REF,
  WORLD_GOLD_CALENDAR,
  WORLD_GOLD_REF,
} from '@/trading/markets/gold/api'
import {
  BOARD_CACHE_TTL_MS,
  FX_LAG_SESSIONS,
  GOLD_VN_MARKET_REF,
  PREFERRED_FORMS,
  USD_VND,
  WORLD_CLOSE_LAG_SESSIONS,
} from '@/trading/markets/gold-vn/policy'
import { selectForm } from '@/trading/markets/gold-vn/premium'
import { assembleGoldBoard } from '@/trading/sources/rows/gold-board'

const VN_REGION = region('vn')
/** The world metal keeps its own sessions, and only they can say which of its closes is final. */
/** The world tape's own sessions: a window of world bars is counted on it, never on the counter's
 *  six-day week, or it reaches back a sixth fewer closes than it asks for. */
export const WORLD_CALENDAR = createTradingCalendar(WORLD_GOLD_CALENDAR)

/** What one fetch of this market produces, before any form is chosen. Selection is pure arithmetic
 *  over these, so caching stops here: a form-keyed cache would refetch three providers per vendor
 *  asked about. */
export interface BoardSnapshot {
  readonly board: GoldBoard
  readonly worldUsdPerOunce: number
  readonly usdVnd: number
  readonly asOf: TradingDay
  readonly observedAt: number
}

export async function readBoard(
  deps: MarketDeps,
  signal: AbortSignal
): Promise<SourceResult<GoldBoard>> {
  const results = await deps.sources.resolveAll({
    kind: 'goldBoard',
    context: { market: GOLD_VN_MARKET_REF, region: VN_REGION },
    signal,
  })
  const [first, ...rest] = results.flatMap((result) =>
    result.kind === 'available' ? [result.value] : []
  )
  const caveats = results.flatMap((result) => result.caveats)

  if (first === undefined) {
    return unavailable('failed', results.flatMap(sourceIds), caveats)
  }

  return available(mergeVendorBoards(first, rest), results.flatMap(provenanceOf), caveats)
}

/** The stamp takes the oldest component of each field: a merged board is only as fresh as the
 *  stalest quote in it, and preferring the newest would hide a lagging vendor behind a current one. */
function mergeVendorBoards(first: GoldBoard, rest: readonly GoldBoard[]): GoldBoard {
  const boards = [first, ...rest]

  return assembleGoldBoard(
    {
      sourceId: first.sourceId,
      fetchedAt: Math.min(...boards.map((board) => board.fetchedAt)),
      observedAt: Math.min(...boards.map((board) => board.observedAt)),
      asOf: boards.reduce(
        (oldest, board) => (board.asOf < oldest ? board.asOf : oldest),
        first.asOf
      ),
    },
    boards.flatMap((board) => board.rows)
  )
}

function readFx(deps: MarketDeps, request: BoardRequest): Promise<SourceResult<FxQuote>> {
  return deps.fx.convert({ ...USD_VND, asOf: request.asOf, signal: request.signal })
}

/** Stale once the counter session after the board's own has opened. An age in hours cannot say
 *  that: six hours after a 13:00 board is a price still on the wall that evening, while six hours
 *  after an 08:30 one is a board the shops have already moved past. Before today's open, and on a
 *  day the counters keep shut, the last board published is the standing quote. */
export function isBoardStale(calendar: TradingCalendar, board: GoldBoard, now: number): boolean {
  const day = calendar.dayAt(now)
  const openedAt = calendar.sessionOpenAt(day)

  if (!calendar.isTradingDay(day) || now < openedAt) {
    return false
  }

  return board.observedAt < openedAt
}

/** Who was asked, whichever way the read went: the provenance of a hit, the attempt list of a miss.
 *  A caveat that names no source cannot be acted on. */
export function sourceIds<T>(result: SourceResult<T>): readonly SourceProvenance['sourceId'][] {
  return result.kind === 'available'
    ? result.provenance.map((entry) => entry.sourceId)
    : result.attemptedSourceIds
}

export async function worldBars(
  deps: MarketDeps,
  request: BarsRequest
): Promise<SourceResult<readonly Candle[]>> {
  const sessions = request.sessions > 0 ? request.sessions : EVIDENCE_SESSIONS
  // The window ends on the world's own last settled session, never on the caller's: COMEX settles
  // hours after the VN counters close, and a bar pulled from inside that gap is still forming, so a
  // premium priced off it drifts all evening while the board it measures stands still.
  const settled = resolveSettledDay(WORLD_CALENDAR, request.now)
  const toDay = request.asOf < settled ? request.asOf : settled
  const result = await deps.sources.resolve({
    kind: 'bars',
    context: {
      market: GOLD_MARKET_REF,
      instrument: WORLD_GOLD_REF,
      fromDay: WORLD_CALENDAR.addTradingDays(toDay, -sessions),
      toDay,
      limit: sessions,
    },
    signal: request.signal,
  })

  return result.kind === 'available'
    ? available(result.value, result.provenance, [
        ...result.caveats,
        { code: 'source.unit-mismatch', detail: { quoteUnit: 'currency-per-troy-ounce' } },
      ])
    : result
}

/** A chosen form carrying the snapshot it was priced from, so a caller can date the reading. */
interface BoardSelection extends FormSelection {
  readonly asOf: TradingDay
  readonly observedAt: number
}

interface BoardRequest {
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

export interface BoardCache {
  get(request: BoardRequest): Promise<SourceResult<BoardSnapshot>>
}

interface CachedBoard {
  readonly result: Extract<SourceResult<BoardSnapshot>, { readonly kind: 'available' }>
  readonly fetchedAt: number
}

export function boardCache(deps: MarketDeps, manifest: MarketManifest): BoardCache {
  let cached: CachedBoard | null = null

  return {
    async get(request) {
      // The TTL bounds refetching; the calendar decides whether the board is still a price anyone
      // quotes. A session can open inside the window, so a hit is re-tested rather than trusted.
      if (
        cached !== null &&
        cached.result.value.asOf === request.asOf &&
        request.now - cached.fetchedAt <= BOARD_CACHE_TTL_MS &&
        !isBoardStale(manifest.calendar, cached.result.value.board, request.now)
      ) {
        return cached.result
      }

      const result = await loadBoardSnapshot(deps, manifest, request)

      if (result.kind === 'available' && !request.signal.aborted) {
        cached = { result, fetchedAt: request.now }
      }

      return result
    },
  }
}

async function loadBoardSnapshot(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: BoardRequest
): Promise<SourceResult<BoardSnapshot>> {
  const [board, fx, world] = await Promise.all([
    readBoard(deps, request.signal),
    readFx(deps, request),
    worldBars(deps, {
      instrument: WORLD_GOLD_REF,
      asOf: request.asOf,
      now: request.now,
      sessions: 2,
      signal: request.signal,
    }),
  ])

  return resolveSnapshot({ board, fx, world }, manifest.calendar, request)
}

interface SnapshotOperands {
  readonly board: SourceResult<GoldBoard>
  readonly fx: SourceResult<FxQuote>
  readonly world: SourceResult<readonly Candle[]>
}

function resolveSnapshot(
  operands: SnapshotOperands,
  calendar: TradingCalendar,
  request: BoardRequest
): SourceResult<BoardSnapshot> {
  const { board, fx, world } = operands
  const caveats = [...board.caveats, ...fx.caveats, ...world.caveats]

  if (board.kind === 'unavailable' || fx.kind === 'unavailable' || world.kind === 'unavailable') {
    return unavailable(
      'failed',
      [...sourceIds(board), ...sourceIds(fx), ...sourceIds(world)],
      caveats
    )
  }

  const worldClose = world.value[world.value.length - 1]

  if (worldClose === undefined) {
    return unavailable('failed', sourceIds(world), caveats)
  }

  const provenance = [...board.provenance, ...fx.provenance, ...world.provenance]

  // The caveat renders `stale[0]` and no other, so the board leads: a stale board is why the other
  // legs stopped agreeing, not a consequence of it.
  const stale: SourceProvenance['sourceId'][] = []

  if (isBoardStale(calendar, board.value, request.now)) {
    stale.push(...sourceIds(board))
  }

  if (!isSameTradingWindow(calendar, [worldClose.at, board.value.asOf], WORLD_CLOSE_LAG_SESSIONS)) {
    stale.push(...sourceIds(world))
  }

  if (!isSameTradingWindow(calendar, [fx.value.asOf, board.value.asOf], FX_LAG_SESSIONS)) {
    stale.push(...sourceIds(fx))
  }

  if (stale.length > 0) {
    return unavailable(
      'stale',
      provenance.map((entry) => entry.sourceId),
      [...caveats, sourcedCaveat('source.stale-cache', stale, { sourceKind: 'goldBoard' })]
    )
  }

  return available(
    {
      board: board.value,
      worldUsdPerOunce: worldClose.close,
      usdVnd: fx.value.rate,
      asOf: board.value.asOf,
      observedAt: board.value.observedAt,
    },
    provenance,
    [...caveats, ...laggingWorldCloseCaveat(board.value.asOf, worldClose.at)]
  )
}

/** A premium priced off yesterday's world close is the normal Monday reading, and the reader has to
 *  be told which close it was: gold can gap over a weekend, and two days carrying one date would
 *  hide that the legs are not from the same session. */
function laggingWorldCloseCaveat(boardDay: TradingDay, worldDay: TradingDay): readonly Caveat[] {
  return worldDay >= boardDay
    ? []
    : [{ code: 'market-data.world-close-lagging', detail: { observedOn: worldDay } }]
}

/** Omitting `form` leaves the pick to `PREFERRED_FORMS`. */
export function selectFromBoard(
  snapshot: SourceResult<BoardSnapshot>,
  form?: VnGoldForm
): SourceResult<BoardSelection> {
  if (snapshot.kind === 'unavailable') {
    return snapshot
  }

  const { board, worldUsdPerOunce, usdVnd, asOf, observedAt } = snapshot.value
  const selected = selectForm({
    board,
    preferredForms: PREFERRED_FORMS,
    worldUsdPerOunce,
    usdVnd,
    ...(form === undefined ? {} : { form }),
  })

  // Nothing was looked up by symbol here: policy asked for any preferred form and the board priced
  // none, so the miss is coverage rather than an unlisted ticker.
  if (selected === undefined) {
    return unavailable('unsupported', sourceIds(snapshot), [
      ...snapshot.caveats,
      { code: 'market-data.no-coverage' },
    ])
  }

  return available({ ...selected, asOf, observedAt }, snapshot.provenance, snapshot.caveats)
}

/** World gold trades a UTC day and the vendor board a Hanoi one, so the newest world bar is
 *  legitimately behind the board; far enough behind and it is a cross-day operand. Sessions, not
 *  calendar days, and the counter calendar is the one asked because it is the board's own. The
 *  world leg keeps a wider weekend and its own holidays, so every gap the two calendars do not
 *  share is the caller's allowance to declare. */
export function isSameTradingWindow(
  calendar: TradingCalendar,
  days: readonly [TradingDay, TradingDay],
  maximumLagSessions: number
): boolean {
  const [left, right] = days
  const [earlier, later] = left < right ? ([left, right] as const) : ([right, left] as const)

  return calendar.addTradingDays(earlier, maximumLagSessions) >= later
}
