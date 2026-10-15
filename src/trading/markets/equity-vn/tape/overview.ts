import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketRequest } from '@/trading/kernel/market/market-capability'
import type { Candle, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type {
  MarketBoard,
  MarketDataOverview,
  MarketDataOverviewRow,
  MarketLeader,
  MarketLeaders,
  MarketMover,
  MarketMovers,
  MarketRange,
  MarketRatios,
} from '@/trading/kernel/market/market-overview'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import type { NameEvidence } from '@/trading/markets/equity-vn/factors/factors'
import type { MarketManifest } from '@/trading/markets/types'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import {
  latestNameSession,
  sessionBar,
  VN_INDEX_INSTRUMENT,
} from '@/trading/markets/equity-vn/factors/factors'
import {
  MINIMUM_MOVER_TURNOVER_VND,
  MINIMUM_TAPE_PARTICIPATION_FRACTION,
  VN_BOARD_ORDER,
  VN_HEADLINE_INDEX_TICKERS,
  VN_OVERVIEW_LEADERS,
  VN_OVERVIEW_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import { loadUniverse } from '@/trading/markets/equity-vn/refresh/universe'
import { toBreadth } from '@/trading/markets/equity-vn/tape/breadth'
import { vnIntradayBreadth } from '@/trading/markets/equity-vn/tape/intraday-breadth'
import { overviewCaveats } from '@/trading/markets/equity-vn/tape/overview-caveats'
import { headlineLevel, vnLiveIndexReading } from '@/trading/markets/equity-vn/tape/quote'
import {
  type SessionValue,
  sessionChangePct,
  sessionForeignNet,
  sessionProprietaryNet,
  sessionTotal,
  sessionTurnover,
  toTurnoverRatio,
  toTurnoverReference,
} from '@/trading/markets/equity-vn/tape/session-totals'
import { toVnExchange } from '@/trading/markets/equity-vn/tradeability'
import { barTurnover } from '@/trading/markets/equity-vn/turnover'
import { OVERVIEW_LEADER_SESSIONS, rangeFromCloses } from '@/trading/markets/overview'
import { median, sessionChange } from '@/trading/markets/timeseries'

const PERCENT_PER_UNIT = 100
const BOARD_SEPARATOR = ' + '
interface OverviewLoad {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly crossSection: CrossSectionCache
  readonly request: MarketRequest
}

interface OverviewEntry {
  readonly row: MarketDataOverviewRow
  readonly at: TradingDay
  readonly provenance: SourceProvenance
}

/** One exchange and the names that list on it. */
type BoardGroup = readonly [string, readonly NameEvidence[]]

/** Settled bars, not a quote: no provider types a VN index as an instrument, so the stored daily
 *  series is the only index tape this market has. The market-wide roll-ups ride the population
 *  pass the screen already makes, so they cost no fetch. */
export async function runOverview(load: OverviewLoad): Promise<MarketDataOverview> {
  const { asOf, now, signal } = load.request
  const [entries, cross] = await Promise.all([
    headlineEntries(load),
    load.crossSection.get(asOf, signal),
  ])
  // The last session the index actually traded, not the calendar's current day: through every
  // morning until the close those differ, and dating this session's roll-ups to a day the tape has
  // no rows for drops each of them silently.
  const session = latestNameSession(cross.names) ?? latestSession(entries) ?? asOf
  const indexBars = cross.indexBars
  const rows = entries.map((entry) => entry.row)
  const breadth = toBreadth(cross.names, session, indexBars)
  const turnover = sessionTotal(cross.names, session, sessionTurnover)
  const turnoverReference = toTurnoverReference(cross.names, session)
  const turnoverRatio = toTurnoverRatio(turnover, turnoverReference)
  const foreignNetValue = sessionTotal(cross.names, session, sessionForeignNet)
  const proprietaryNetValue = sessionTotal(cross.names, session, sessionProprietaryNet)
  const leaders = toLeaders(cross.names, session)
  const movers = toMovers(cross.names, session)
  const groups = groupByBoard(cross.names)
  const boards = toBoards(groups, session)
  const range = indexRange(indexBars, entries)
  const ratios = toRatios(cross.names)
  const intraday = await vnIntradayBreadth(
    { deps: load.deps, manifest: load.manifest, settled: session, now, signal },
    cross.names.map((name) => name.record)
  )

  return {
    market: load.manifest.id,
    asOf: session,
    currency: load.manifest.currency,
    // No `priceCurrency`: these rows are index levels, which no currency denominates.
    icon: load.manifest.icon,
    rows,
    ...optionalUniverse(groups),
    ...(breadth === undefined ? {} : { breadth }),
    narrowDeclineBelowPct: MINIMUM_TAPE_PARTICIPATION_FRACTION,
    ...(intraday.breadth === undefined ? {} : { intraday: intraday.breadth }),
    ...(turnover === undefined ? {} : { turnover }),
    ...(turnoverRatio === undefined ? {} : { turnoverRatio }),
    ...(turnoverReference === undefined ? {} : { turnoverReference }),
    ...(foreignNetValue === undefined ? {} : { foreignNetValue }),
    ...(proprietaryNetValue === undefined ? {} : { proprietaryNetValue }),
    ...(range === undefined ? {} : { range }),
    ...(ratios === undefined ? {} : { ratios }),
    ...(leaders === undefined ? {} : { leaders }),
    ...(movers === undefined ? {} : { movers }),
    ...(boards.length === 0 ? {} : { boards }),
    provenance: dedupeProvenance(entries.map((entry) => entry.provenance)),
    caveats: overviewCaveats({ rows, boards, session, indexBars, intraday: intraday.caveats }),
  }
}

/** The newest level the index has printed: the live reading while a session runs, the settled close
 *  its row states otherwise. Not the last of `cross.indexBars`, which is a session behind whenever
 *  the index endpoint is still withholding the settled bar. */
function indexLevel(entries: readonly OverviewEntry[]): number | undefined {
  const row = entries.find(
    (entry) => entry.row.instrument.ticker === VN_INDEX_INSTRUMENT.ticker
  )?.row

  return row?.live?.price ?? row?.quote?.price
}

/** The swing the index has traded in, measured from the level it is quoting now rather than from
 *  the close the window was drawn to. */
function indexRange(
  bars: readonly Candle[],
  entries: readonly OverviewEntry[]
): MarketRange | undefined {
  return rangeFromCloses(
    bars.map((candle) => candle.close),
    indexLevel(entries)
  )
}

/** Median price ratios across the measured universe, each derived from today's close against the
 *  fundamental the source published. A name with no earnings or no book value is simply absent, so a
 *  market of banks and startups still yields a median that describes the names it has. */
function toRatios(names: readonly NameEvidence[]): MarketRatios | undefined {
  const pes: number[] = []
  const pbs: number[] = []

  for (const name of names) {
    const close = name.closes[name.closes.length - 1]
    const fundamental = name.fundamental

    if (fundamental === null || close === undefined || close <= 0) {
      continue
    }

    if (fundamental.earningsPerShare !== undefined && fundamental.earningsPerShare > 0) {
      pes.push(close / fundamental.earningsPerShare)
    }

    if (fundamental.bookValuePerShare !== undefined && fundamental.bookValuePerShare > 0) {
      pbs.push(close / fundamental.bookValuePerShare)
    }
  }

  const medianPe = median(pes)
  const medianPb = median(pbs)

  return medianPe === undefined || medianPb === undefined ? undefined : { medianPe, medianPb }
}

function latestSession(entries: readonly OverviewEntry[]): TradingDay | undefined {
  return entries.map((entry) => entry.at).sort()[entries.length - 1]
}

/** Who the session's money went to. Both flow directions, because a market that sold on balance
 *  still had names being accumulated, and that is the half a net figure hides. A list nobody
 *  qualified for is absent rather than empty — an empty list would read as "these are the leaders".
 */
function toLeaders(names: readonly NameEvidence[], session: TradingDay): MarketLeaders | undefined {
  const turnoverTotal = sessionTotal(names, session, sessionTurnover) ?? 0
  const flows = rankNames(names, session, sessionForeignNet)
  const buyers = flows.filter((entry) => entry.value > 0)
  const sellers = flows.filter((entry) => entry.value < 0)
  const foreignBuys = buyers.slice(0, VN_OVERVIEW_LEADERS)
  const foreignSells = sellers.slice(-VN_OVERVIEW_LEADERS).reverse()
  const mostTraded = rankNames(names, session, sessionTurnover).slice(0, VN_OVERVIEW_LEADERS)

  if (foreignBuys.length === 0 && foreignSells.length === 0 && mostTraded.length === 0) {
    return undefined
  }

  return {
    window: 'session',
    sessions: OVERVIEW_LEADER_SESSIONS,
    ...(foreignBuys.length === 0
      ? {}
      : { foreignBuys: withShare(foreignBuys, grossValue(buyers)) }),
    ...(foreignSells.length === 0
      ? {}
      : { foreignSells: withShare(foreignSells, grossValue(sellers)) }),
    ...(mostTraded.length === 0 ? {} : { mostTraded: withShare(mostTraded, turnoverTotal) }),
  }
}

/** A direction's gross flow: a share of the net would pass 100% on a day the other side nearly
 *  cancelled it. */
function grossValue(leaders: readonly MarketLeader[]): number {
  return leaders.reduce((sum, leader) => sum + Math.abs(leader.value), 0)
}

/** Each leader's value as a share of the session's total for its list — how concentrated the top is.
 *  A name that did not trade reports no value, so it never appears; a zero total yields no share. */
function withShare(leaders: readonly MarketLeader[], total: number): MarketLeader[] {
  if (total === 0) {
    return leaders.map((leader) => ({ ...leader }))
  }

  return leaders.map((leader) => ({ ...leader, sharePct: Math.abs(leader.value) / total }))
}

/** Descending, so a caller takes buys from the head and sells from the tail of one sorted pass. */
function rankNames(
  names: readonly NameEvidence[],
  session: TradingDay,
  of: SessionValue
): readonly MarketLeader[] {
  return names
    .flatMap((name) => {
      const value = of(name, session)

      if (value === undefined) {
        return []
      }

      const changePct = sessionChangePct(name, session)

      return [
        {
          instrument: name.record.instrument,
          value,
          ...(changePct === undefined ? {} : { changePct }),
        },
      ]
    })
    .sort((left, right) => right.value - left.value)
}

/** One grouping feeds both the per-board rows and the label naming what the totals cover; two
 *  would eventually disagree about which boards were measured. */
export function groupByBoard(names: readonly NameEvidence[]): readonly BoardGroup[] {
  const byBoard = new Map<string, NameEvidence[]>()

  for (const name of names) {
    const board = toVnExchange(name.record.exchange)

    if (board !== undefined) {
      const members = byBoard.get(board) ?? []

      members.push(name)
      byBoard.set(board, members)
    }
  }

  return [...byBoard.entries()].sort(
    ([left], [right]) => boardRank(left) - boardRank(right) || left.localeCompare(right)
  )
}

/** Declared boards in their reading order, everything else after them and alphabetical among
 *  themselves. */
function boardRank(board: string): number {
  const declared = VN_BOARD_ORDER.indexOf(board)

  return declared === -1 ? VN_BOARD_ORDER.length : declared
}

/** Absent where no name carried a board: a label over nothing claims a coverage this read never
 *  had. */
function optionalUniverse(groups: readonly BoardGroup[]): { universe?: string } {
  return groups.length === 0
    ? {}
    : { universe: groups.map(([board]) => board).join(BOARD_SEPARATOR) }
}

/** The same session split by exchange: every VN source publishes the boards apart, so a blended
 *  count is the one a reader cannot check. One board yields no split — the totals already say it. */
export function toBoards(
  groups: readonly BoardGroup[],
  session: TradingDay
): readonly MarketBoard[] {
  return groups.length < 2 ? [] : groups.map(([board, members]) => toBoard(board, members, session))
}

/** A field the board could not measure is absent, never zero — the same rule the market totals
 *  follow. */
function toBoard(
  board: string,
  members: readonly NameEvidence[],
  session: TradingDay
): MarketBoard {
  const breadth = toBreadth(members, session)
  const turnover = sessionTotal(members, session, sessionTurnover)
  const foreignNetValue = sessionTotal(members, session, sessionForeignNet)

  return {
    board,
    ...(breadth === undefined ? {} : { breadth }),
    ...(turnover === undefined ? {} : { turnover }),
    ...(foreignNetValue === undefined ? {} : { foreignNetValue }),
  }
}

/** The session's two extremes. Ranked only over names that traded at least the liquidity floor
 *  today, because the literal top gainer of a VN session is otherwise a shell at its ceiling on a
 *  few million đồng — true, and no answer to what moved. */
function toMovers(names: readonly NameEvidence[], session: TradingDay): MarketMovers | undefined {
  const moved = names
    .map((name) => toMover(name, session))
    .filter((mover) => mover !== undefined)
    .sort((left, right) => right.changePct - left.changePct)
  const gainers = moved.filter((mover) => mover.changePct > 0).slice(0, VN_OVERVIEW_LEADERS)
  const losers = moved
    .filter((mover) => mover.changePct < 0)
    .slice(-VN_OVERVIEW_LEADERS)
    .reverse()

  return gainers.length === 0 && losers.length === 0
    ? undefined
    : { window: 'session', gainers, losers }
}

/** Today's move and only today's, and only when a listed share moved real money on it. A basket
 *  restates the index rather than naming a mover, as in the breadth tally. */
function toMover(name: NameEvidence, session: TradingDay): MarketMover | undefined {
  const last = sessionBar(name, session)

  if (last === undefined || name.record.kind !== 'equity') {
    return undefined
  }

  const changePct = sessionChangePct(name, session)
  const turnover = barTurnover(last)

  if (changePct === undefined || turnover === undefined || turnover < MINIMUM_MOVER_TURNOVER_VND) {
    return undefined
  }

  return { instrument: name.record.instrument, changePct, turnover }
}

/** Only the tape this market publishes as its own: the scope also stores the ETF benchmark legs,
 *  and a row for one costs a live reading no provider serves for it. */
async function headlineEntries(load: OverviewLoad): Promise<readonly OverviewEntry[]> {
  const { signal } = load.request
  const indices = await loadUniverse(load.deps, { kind: 'index', signal })
  const headline = indices.filter((record) =>
    VN_HEADLINE_INDEX_TICKERS.includes(record.instrument.ticker)
  )
  const loaded = await Promise.all(headline.map((record) => overviewRow(load, record)))

  return loaded.filter((entry) => entry !== undefined)
}

async function overviewRow(
  load: OverviewLoad,
  record: InstrumentRecord
): Promise<OverviewEntry | undefined> {
  const bars = await load.deps.marketDataStore.listBars({
    instrument: record.instrument,
    fromDay: load.manifest.calendar.addTradingDays(load.request.asOf, -VN_OVERVIEW_SESSIONS),
    toDay: load.request.asOf,
    signal: load.request.signal,
  })
  const last = bars[bars.length - 1]

  if (last === undefined) {
    return undefined
  }

  const change = sessionChange(bars.map((bar) => bar.candle.close))
  const turnover = last.turnover
  const reading = await vnLiveIndexReading(load.deps, load.manifest, {
    instrument: record.instrument,
    asOf: load.request.asOf,
    now: load.request.now,
    settledDay: last.candle.at,
    signal: load.request.signal,
  })
  const level = headlineLevel(
    {
      price: last.candle.close,
      at: last.candle.at,
      ...(change === undefined ? {} : { changePct: change * PERCENT_PER_UNIT }),
    },
    reading,
    { calendar: load.manifest.calendar, now: load.request.now }
  )

  return {
    at: level.close.at,
    row: {
      instrument: record.instrument,
      quote: {
        instrument: record.instrument,
        price: level.close.price,
        observedAt: load.manifest.calendar.sessionCloseAt(level.close.at),
      },
      closedOn: level.close.at,
      ...(level.close.changePct === undefined ? {} : { changePct: level.close.changePct }),
      // From the stored bar, so a promoted close carries the prior session's; it only orders rows.
      ...(turnover === undefined ? {} : { turnover }),
      ...(level.live === undefined ? {} : { live: level.live }),
    },
    provenance: { sourceId: last.sourceId, fetchedAt: last.fetchedAt, freshness: 'cached' },
  }
}
