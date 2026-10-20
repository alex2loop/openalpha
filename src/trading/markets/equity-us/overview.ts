import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MarketRequest } from '@/trading/kernel/market/market-capability'
import type { BarRecord } from '@/trading/kernel/market/market-data'
import type {
  MarketBreadth,
  MarketDataOverview,
  MarketDataOverviewRow,
  MarketLeader,
  MarketLeaders,
  MarketMover,
  MarketMovers,
} from '@/trading/kernel/market/market-overview'
import type { MarketDeps } from '@/trading/markets/deps'
import type { UsBoard, UsBoardCache, UsBoardName } from '@/trading/markets/equity-us/board'
import type { MarketManifest } from '@/trading/markets/types'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import {
  US_BENCHMARK_TICKER,
  US_EVIDENCE_SESSIONS,
  US_INDEX_TICKERS,
  US_MARKET_REF,
} from '@/trading/markets/equity-us/policy'
import { usBarProvenance } from '@/trading/markets/equity-us/raws'
import { usAdjustedCloses } from '@/trading/markets/equity-us/screen'
import { OVERVIEW_LEADER_SESSIONS } from '@/trading/markets/overview'
import { MAXIMUM_NAMES_PER_LIST } from '@/trading/markets/overview-rollups'
import { sessionChange } from '@/trading/markets/timeseries'
import { barTurnover } from '@/trading/markets/turnover'

const PERCENT_PER_UNIT = 100

interface OverviewLoad {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly board: UsBoardCache
  readonly request: MarketRequest
}

interface NameSession {
  readonly name: UsBoardName
  readonly changePct: number
  readonly turnover: number
}

/** The headline indices as levels and the benchmark fund as a price, then roll-ups folded over the
 *  board. Every roll-up is the board's, not the listing's, and absent where nothing could be
 *  measured: a total of nothing would read as a market that is worth nothing. */
export async function runUsOverview(load: OverviewLoad): Promise<MarketDataOverview> {
  const { request, manifest } = load
  const board = await load.board.get(request.asOf, request.signal)
  const rows = await headlineRows(load)
  const sessions = board.names.flatMap(toNameSession)
  const marketCap = board.names.reduce((sum, name) => sum + name.marketCap, 0)
  const turnover = sessions.reduce((sum, entry) => sum + entry.turnover, 0)
  const day = latestSession(board)

  return {
    market: manifest.id,
    asOf: day ?? request.asOf,
    currency: manifest.currency,
    priceCurrency: manifest.currency,
    icon: manifest.icon,
    rows,
    ...(marketCap > 0 ? { marketCap } : {}),
    ...(turnover > 0 ? { turnover } : {}),
    ...optionalBreadth(sessions),
    ...optionalLeaders(sessions),
    ...optionalMovers(sessions),
    provenance: dedupeProvenance(board.names.flatMap((name) => usBarProvenance(name.bars))),
    caveats: board.names.length === 0 ? [{ code: 'market-data.universe-empty' }] : [],
  }
}

/** The indices and the benchmark, read from the store like any name. */
async function headlineRows(load: OverviewLoad): Promise<readonly MarketDataOverviewRow[]> {
  const instruments: readonly InstrumentRef[] = [
    ...US_INDEX_TICKERS.map((ticker) => ({ market: US_MARKET_REF, ticker })),
    { market: US_MARKET_REF, ticker: US_BENCHMARK_TICKER },
  ]
  const { request, deps, manifest } = load
  const fromDay = manifest.calendar.addTradingDays(request.asOf, -US_EVIDENCE_SESSIONS)
  const series = await Promise.all(
    instruments.map((instrument) =>
      deps.marketDataStore.listBars({
        instrument,
        fromDay,
        toDay: request.asOf,
        signal: request.signal,
      })
    )
  )

  return series.flatMap((bars, index) => {
    const instrument = instruments[index]

    return instrument === undefined ? [] : toRow(instrument, bars)
  })
}

function toRow(instrument: InstrumentRef, bars: readonly BarRecord[]): MarketDataOverviewRow[] {
  const newest = bars.at(-1)

  if (newest === undefined) {
    return []
  }

  const change = sessionChange(usAdjustedCloses(bars))

  return [
    {
      instrument,
      quote: { instrument, price: newest.candle.close, observedAt: newest.fetchedAt },
      closedOn: newest.candle.at,
      ...(change === undefined ? {} : { changePct: change * PERCENT_PER_UNIT }),
    },
  ]
}

function toNameSession(name: UsBoardName): NameSession[] {
  const change = sessionChange(usAdjustedCloses(name.bars))
  const newest = name.bars.at(-1)
  const turnover = newest === undefined ? undefined : barTurnover(newest)

  return change === undefined || turnover === undefined
    ? []
    : [{ name, changePct: change * PERCENT_PER_UNIT, turnover }]
}

/** The newest settled session across the board: per-name maxima would let one stale name misdate
 *  the whole. */
function latestSession(board: UsBoard): TradingDay | undefined {
  let latest: TradingDay | undefined

  for (const name of board.names) {
    const day = name.bars.at(-1)?.candle.at

    if (day !== undefined && (latest === undefined || day > latest)) {
      latest = day
    }
  }

  return latest
}

function optionalBreadth(sessions: readonly NameSession[]): { breadth?: MarketBreadth } {
  if (sessions.length === 0) {
    return {}
  }

  const advancers = sessions.filter((entry) => entry.changePct > 0).length
  const decliners = sessions.filter((entry) => entry.changePct < 0).length

  return {
    breadth: {
      advancers,
      decliners,
      netAdvancers: advancers - decliners,
      measured: sessions.length,
      ...(advancers + decliners === 0 ? {} : { advanceRatio: advancers / (advancers + decliners) }),
    },
  }
}

function optionalLeaders(sessions: readonly NameSession[]): { leaders?: MarketLeaders } {
  const mostTraded: readonly MarketLeader[] = [...sessions]
    .sort((left, right) => right.turnover - left.turnover)
    .slice(0, MAXIMUM_NAMES_PER_LIST)
    .map((entry) => ({
      instrument: entry.name.record.instrument,
      value: entry.turnover,
      changePct: entry.changePct,
    }))

  return mostTraded.length === 0
    ? {}
    : { leaders: { window: 'session', sessions: OVERVIEW_LEADER_SESSIONS, mostTraded } }
}

function optionalMovers(sessions: readonly NameSession[]): { movers?: MarketMovers } {
  const ranked = [...sessions].sort((left, right) => right.changePct - left.changePct)
  const toMover = (entry: NameSession): MarketMover => ({
    instrument: entry.name.record.instrument,
    changePct: entry.changePct,
    turnover: entry.turnover,
  })
  const gainers = ranked.filter((entry) => entry.changePct > 0).slice(0, MAXIMUM_NAMES_PER_LIST)
  const losers = ranked
    .filter((entry) => entry.changePct < 0)
    .reverse()
    .slice(0, MAXIMUM_NAMES_PER_LIST)

  return gainers.length === 0 && losers.length === 0
    ? {}
    : { movers: { window: 'session', gainers: gainers.map(toMover), losers: losers.map(toMover) } }
}
