import type {
  MarketBoard,
  MarketBreadth,
  MarketDataOverview,
  MarketLeader,
} from '@/trading/kernel/market/market-overview'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import { readySection } from '@/trading/markets/brief-section'

/** Names per list. These are read on a phone beside the operator's own book, so each list states who
 *  led rather than inventorying the session. */
export const MAXIMUM_NAMES_PER_LIST = 3

/** The session's own window: every roll-up here is one settled session, never the longer span the
 *  brief's flow sections sum over. */
const ROLLUP_SESSIONS = 1

/** What a market settled across its whole measured universe, as opposed to what any one instrument
 *  did. `/overview` is the only surface that renders these from the read: the brief builds its own
 *  over a twenty-session window, and the intraday report has already folded them into its settled
 *  block. */
export function rollupSections(overview: MarketDataOverview): readonly BriefSectionResult[] {
  return [
    breadthSection(overview),
    turnoverSection(overview),
    foreignFlowSection(overview),
    proprietaryFlowSection(overview),
  ].filter((section) => section !== undefined)
}

/** Skipped where the market publishes a capitalisation: the market-size section states the same
 *  counts beside the size they belong to, and a board has one breadth, not two. */
function breadthSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows =
    overview.marketCap === undefined
      ? [...breadthRows(overview.breadth), ...boardRows(overview.boards)]
      : []

  return rows.length === 0 ? undefined : readySection(overview, { kind: 'breadth', rows })
}

/** Skipped where the market publishes a capitalisation: that section states the same traded value
 *  beside the size it belongs to, and a market has one turnover, not two. */
function turnoverSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows = overview.marketCap === undefined ? turnoverRows(overview) : []

  return rows.length === 0 ? undefined : readySection(overview, { kind: 'turnover', rows })
}

function foreignFlowSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows = foreignRows(overview)

  return rows.length === 0
    ? undefined
    : readySection(overview, {
        kind: 'foreign-desk-flow',
        rows,
        titleParams: { sessions: ROLLUP_SESSIONS },
      })
}

function proprietaryFlowSection(overview: MarketDataOverview): BriefSectionResult | undefined {
  const rows = proprietaryRows(overview)

  return rows.length === 0
    ? undefined
    : readySection(overview, {
        kind: 'proprietary-flow',
        rows,
        titleParams: { sessions: ROLLUP_SESSIONS },
      })
}

/** Three readings of one session: how many names moved, how many were pinned to the band, and where
 *  the universe stands against its own trend. Each answers a different question, so each is a row. */
export function breadthRows(breadth: MarketBreadth | undefined): readonly BriefSectionRow[] {
  if (breadth === undefined) {
    return []
  }

  const trend: BriefSectionRow = {
    ...(breadth.aboveMa50Ratio === undefined ? {} : { aboveMa50Ratio: breadth.aboveMa50Ratio }),
    ...(breadth.ma50Measured === undefined ? {} : { ma50Measured: breadth.ma50Measured }),
    ...(breadth.indexToMa50Pct === undefined ? {} : { indexToMa50Pct: breadth.indexToMa50Pct }),
    ...(breadth.ma50SlopePct === undefined ? {} : { ma50SlopePct: breadth.ma50SlopePct }),
    ...(breadth.newHighs === undefined ? {} : { newHighs: breadth.newHighs }),
    ...(breadth.newLows === undefined ? {} : { newLows: breadth.newLows }),
  }

  return [
    { advancers: breadth.advancers, decliners: breadth.decliners, measured: breadth.measured },
    {
      netAdvancers: breadth.netAdvancers,
      ...(breadth.ceilings === undefined ? {} : { ceilings: breadth.ceilings }),
      ...(breadth.floors === undefined ? {} : { floors: breadth.floors }),
    },
    ...(Object.keys(trend).length === 0 ? [] : [trend]),
  ]
}

export function turnoverRows(overview: MarketDataOverview): readonly BriefSectionRow[] {
  if (overview.turnover === undefined) {
    return []
  }

  return [
    {
      turnover: overview.turnover,
      ...(overview.turnoverRatio === undefined || overview.turnoverReference === undefined
        ? {}
        : { turnoverRatio: overview.turnoverRatio, sessions: overview.turnoverReference.sessions }),
    },
  ]
}

/** The market's own net first, then the names that made it: a total says the desks were active, the
 *  names say where. */
export function foreignRows(overview: MarketDataOverview): readonly BriefSectionRow[] {
  return [
    ...(overview.foreignNetValue === undefined ? [] : [{ net: overview.foreignNetValue }]),
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
