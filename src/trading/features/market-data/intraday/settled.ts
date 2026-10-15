import type {
  IntradaySettled,
  IntradaySettledField,
} from '@/trading/features/market-data/intraday/types'
import type {
  MarketDataOverview,
  MarketLeader,
  MarketMovers,
  MarketRange,
} from '@/trading/kernel/market/market-overview'
import type { BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import { MOVER_KIND } from '@/trading/kernel/market/market-overview'
import {
  boardRows,
  breadthRows,
  foreignRows,
  proprietaryRows,
  turnoverRows,
} from '@/trading/markets/overview-rollups'

/** Names per list. The block is read on a phone beside the operator's own book, so each list states
 *  who led rather than inventorying the session. */
const MAXIMUM_NAMES_PER_FIELD = 3

/** The settled session as the rows the shared renderer already knows how to label and format. The
 *  list below is the render order, and a field whose market published nothing drops out here rather
 *  than reaching the renderer as an empty list. */
export function toSettled(overview: MarketDataOverview): IntradaySettled {
  const { movers } = overview
  const built: readonly IntradaySettledField[] = [
    { field: 'breadth', rows: breadthRows(overview.breadth) },
    { field: 'turnover', rows: turnoverRows(overview) },
    { field: 'foreign', rows: foreignRows(overview) },
    { field: 'proprietary', rows: proprietaryRows(overview) },
    { field: 'leaders', rows: leaderRows(overview.leaders?.mostTraded) },
    ...(movers === undefined
      ? []
      : [{ field: MOVER_KIND[movers.window], rows: moverRows(movers) }]),
    rangeField(overview.range),
    { field: 'boards', rows: boardRows(overview.boards) },
  ]

  return {
    day: overview.asOf,
    currency: overview.currency,
    fields: built.filter((entry) => entry.rows.length > 0),
  }
}

function leaderRows(leaders: readonly MarketLeader[] | undefined): readonly BriefSectionRow[] {
  return (leaders ?? []).slice(0, MAXIMUM_NAMES_PER_FIELD).map((leader) => ({
    ticker: leader.instrument.ticker,
    turnover: leader.value,
    ...(leader.sharePct === undefined ? {} : { sharePct: leader.sharePct }),
  }))
}

/** Both sides under one field: the sign on each row already says which way a name went, so a second
 *  field would only repeat the label. Each side is capped on its own, or the longer one crowds the
 *  other out. */
function moverRows(movers: MarketMovers): readonly BriefSectionRow[] {
  return [
    ...movers.gainers.slice(0, MAXIMUM_NAMES_PER_FIELD),
    ...movers.losers.slice(0, MAXIMUM_NAMES_PER_FIELD),
  ].map((mover) => ({ ticker: mover.instrument.ticker, changePct: mover.changePct }))
}

/** The window rides the label rather than a row: a swing measured over a month and one measured over
 *  a year are different numbers under the same two words, and `/overview` already states it. */
function rangeField(range: MarketRange | undefined): IntradaySettledField {
  if (range === undefined) {
    return { field: 'range', rows: [] }
  }

  return {
    field: 'range',
    rows: [
      { support: range.support, supportPct: range.supportPct },
      { resistance: range.resistance, resistancePct: range.resistancePct },
    ],
    labelParams: { sessions: range.sessions },
  }
}
