import type {
  MarketBoard,
  MarketBreadth,
  MarketDataOverview,
  MarketLeader,
  SectorTurnover,
  SessionMean,
} from '@/trading/kernel/market/market-overview'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import { readySection } from '@/trading/markets/brief-section'

/** Names per list. These are read on a phone beside the operator's own book, so each list states who
 *  led rather than inventorying the session. */
export const MAXIMUM_NAMES_PER_LIST = 3

/** The session's own window: every roll-up here is one settled session, never the longer span the
 *  brief's flow sections sum over. */
const ROLLUP_SESSIONS = 1

/** What a breadth reading says about trend rather than about the session's counts, so a fold that
 *  measures only these can publish them. */
export type BreadthTrend = Pick<
  MarketBreadth,
  | 'aboveMa50Ratio'
  | 'ma50Measured'
  | 'aboveMa200Ratio'
  | 'ma200Measured'
  | 'indexToMa50Pct'
  | 'ma50SlopePct'
  | 'newHighs'
  | 'newLows'
  | 'distribution'
>

/** What a market settled across its whole measured universe, as opposed to what any one instrument
 *  did. `/overview` is the only surface that renders these from the read: the brief builds its own
 *  over a twenty-session window, and the intraday report has already folded them into its settled
 *  block. */
export function rollupSections(overview: MarketDataOverview): readonly BriefSectionResult[] {
  return [
    breadthSection(overview),
    turnoverSection(overview),
    sectorTurnoverSection(overview),
    foreignFlowSection(overview),
    proprietaryFlowSection(overview),
  ].filter((section) => section !== undefined)
}

/** Where the market publishes a capitalization the market-size section already states the counts
 *  beside the size they belong to, and a board has one breadth, not two: only the trend is added. */
function breadthSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows =
    overview.marketCap === undefined
      ? [...breadthRows(overview.breadth), ...boardRows(overview.boards)]
      : breadthTrendRows(overview.breadth ?? {})

  return rows.length === 0 ? undefined : readySection(overview, { kind: 'breadth', rows })
}

/** Skipped where the market publishes a capitalization: that section states the same traded value
 *  beside the size it belongs to, and a market has one turnover, not two. */
function turnoverSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows = overview.marketCap === undefined ? turnoverRows(overview) : []

  return rows.length === 0 ? undefined : readySection(overview, { kind: 'turnover', rows })
}

function sectorTurnoverSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows = sectorTurnoverRows(overview.sectorTurnover)

  return rows.length === 0 ? undefined : readySection(overview, { kind: 'sector-turnover', rows })
}

/** Only the names where the flow balance is for this session: that block states the foreign total
 *  beside the other two groups, and a net said twice reads as two findings. While the desks lag, the
 *  block is for an earlier session, so this section keeps today's total. */
function foreignFlowSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows =
    overview.flowBalance?.session === overview.asOf
      ? foreignNameRows(overview)
      : foreignRows(overview)

  return rows.length === 0
    ? undefined
    : readySection(overview, {
        kind: 'foreign-desk-flow',
        rows,
        titleParams: { sessions: ROLLUP_SESSIONS },
      })
}

/** Skipped where the market publishes a flow balance, which states the desks' net itself. */
function proprietaryFlowSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows = overview.flowBalance === undefined ? proprietaryRows(overview) : []

  return rows.length === 0
    ? undefined
    : readySection(overview, {
        kind: 'proprietary-flow',
        rows,
        titleParams: { sessions: ROLLUP_SESSIONS },
      })
}

/** The readings of one session: how many names moved, how many were pinned to the band, and where
 *  the universe stands against its own trend. Each answers a different question, so each is a row. */
export function breadthRows(breadth: MarketBreadth | undefined): readonly BriefSectionRow[] {
  if (breadth === undefined) {
    return []
  }

  return [
    { advancers: breadth.advancers, decliners: breadth.decliners, measured: breadth.measured },
    {
      netAdvancers: breadth.netAdvancers,
      ...(breadth.ceilings === undefined ? {} : { ceilings: breadth.ceilings }),
      ...(breadth.floors === undefined ? {} : { floors: breadth.floors }),
    },
    ...breadthTrendRows(breadth),
  ]
}

/** One row per moving-average window, each share beside the count it is out of, then the index's
 *  own trend, then one row per index fund's distribution days. Empty when none was measured. */
export function breadthTrendRows(trend: BreadthTrend): readonly BriefSectionRow[] {
  const rows: readonly BriefSectionRow[] = [
    {
      ...(trend.aboveMa50Ratio === undefined ? {} : { aboveMa50Ratio: trend.aboveMa50Ratio }),
      ...(trend.ma50Measured === undefined ? {} : { ma50Measured: trend.ma50Measured }),
    },
    {
      ...(trend.aboveMa200Ratio === undefined ? {} : { aboveMa200Ratio: trend.aboveMa200Ratio }),
      ...(trend.ma200Measured === undefined ? {} : { ma200Measured: trend.ma200Measured }),
    },
    {
      ...(trend.indexToMa50Pct === undefined ? {} : { indexToMa50Pct: trend.indexToMa50Pct }),
      ...(trend.ma50SlopePct === undefined ? {} : { ma50SlopePct: trend.ma50SlopePct }),
      ...(trend.newHighs === undefined ? {} : { newHighs: trend.newHighs }),
      ...(trend.newLows === undefined ? {} : { newLows: trend.newLows }),
    },
  ]

  return [
    ...rows.filter((row) => Object.keys(row).length > 0),
    ...(trend.distribution ?? []).map((entry) => ({
      ticker: entry.ticker,
      distributionDays: entry.days,
      sessions: entry.sessions,
    })),
  ]
}

export function turnoverRows(overview: MarketDataOverview): readonly BriefSectionRow[] {
  if (overview.turnover === undefined) {
    return []
  }

  return [
    {
      turnover: overview.turnover,
      ...ratioFields(overview.turnoverRatio, overview.turnoverReference),
    },
  ]
}

/** A ratio only beside the sessions its mean covers: every window yields a different multiple. */
function ratioFields(
  turnoverRatio: number | undefined,
  reference: SessionMean | undefined
): BriefSectionRow {
  return turnoverRatio === undefined || reference === undefined
    ? {}
    : { turnoverRatio, sessions: reference.sessions }
}

function sectorTurnoverRows(
  sectors: readonly SectorTurnover[] | undefined
): readonly BriefSectionRow[] {
  return (sectors ?? []).map((entry) => ({
    sector: entry.sector,
    turnover: entry.turnover,
    sharePct: entry.sharePct,
    ...ratioFields(entry.turnoverRatio, entry.turnoverReference),
  }))
}

/** The market's own net first, then the names that made it: a total says the desks were active, the
 *  names say where. */
export function foreignRows(overview: MarketDataOverview): readonly BriefSectionRow[] {
  return [...foreignTotalRows(overview), ...foreignNameRows(overview)]
}

function foreignTotalRows(overview: MarketDataOverview): readonly BriefSectionRow[] {
  return overview.foreignNetValue === undefined ? [] : [{ net: overview.foreignNetValue }]
}

function foreignNameRows(overview: MarketDataOverview): readonly BriefSectionRow[] {
  return [
    ...nameFlowRows(overview.leaders?.foreignBuys),
    ...nameFlowRows(overview.leaders?.foreignSells),
  ]
}

export function proprietaryRows(overview: MarketDataOverview): readonly BriefSectionRow[] {
  return overview.proprietaryNetValue === undefined ? [] : [{ net: overview.proprietaryNetValue }]
}

export function boardRows(boards: readonly MarketBoard[] | undefined): readonly BriefSectionRow[] {
  return (boards ?? []).map((board) => ({
    board: board.board,
    ...(board.breadth === undefined
      ? {}
      : { advancers: board.breadth.advancers, decliners: board.breadth.decliners }),
    ...(board.turnover === undefined ? {} : { turnover: board.turnover }),
    ...(board.foreignNetValue === undefined ? {} : { foreignNetBase: board.foreignNetValue }),
  }))
}

function nameFlowRows(leaders: readonly MarketLeader[] | undefined): readonly BriefSectionRow[] {
  return (leaders ?? [])
    .slice(0, MAXIMUM_NAMES_PER_LIST)
    .map((leader) => ({ ticker: leader.instrument.ticker, net: leader.value }))
}
