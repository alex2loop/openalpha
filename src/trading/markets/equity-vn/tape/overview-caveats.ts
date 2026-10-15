import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { MarketBoard, MarketDataOverviewRow } from '@/trading/kernel/market/market-overview'
import { staleIndexCaveats } from '@/trading/markets/equity-vn/tape/breadth'

/** Below this share of the boards' gross foreign flow, the market total is what two boards running
 *  opposite ways left behind rather than either one's session. */
const CANCELLING_BOARD_FLOW_RATIO = 0.5

interface OverviewCaveatInput {
  /** What the read actually priced; nothing else matters when it reached no instrument at all. */
  readonly rows: readonly MarketDataOverviewRow[]
  readonly boards: readonly MarketBoard[]
  readonly session: TradingDay
  readonly indexBars: readonly Candle[]
  readonly intraday: readonly Caveat[]
}

/** Everything qualifying the overview block, in one place so the read states each fact once. */
export function overviewCaveats(input: OverviewCaveatInput): readonly Caveat[] {
  const { boards, session } = input

  if (input.rows.length === 0) {
    return [{ code: 'market-data.no-coverage' }]
  }

  return [
    // Dated, because the message travels beside live rows: "this session" there reads as the one
    // trading now, while these boards are the settled session's.
    ...(boardFlowCancels(boards)
      ? [{ code: 'market-data.board-flow-diverges' as const, detail: { day: session } }]
      : []),
    ...staleIndexCaveats(input.indexBars, session),
    ...input.intraday,
  ]
}

/** Whether the boards offset each other enough that their total is the residue of two sessions
 *  rather than what the leading board published. Sign disagreement alone does not say so: measured
 *  over 37 stored sessions it holds on 22, and on 18 of those the offsetting board is under a tenth
 *  of the gross — HNX at -1,29 tỷ against HOSE at +718 tỷ carried this warning onto three surfaces
 *  telling the reader not to trust the figure printed beside it. */
function boardFlowCancels(boards: readonly MarketBoard[]): boolean {
  const flows = boards.flatMap((board) =>
    board.foreignNetValue === undefined || board.foreignNetValue === 0
      ? []
      : [board.foreignNetValue]
  )

  if (new Set(flows.map((flow) => Math.sign(flow))).size < 2) {
    return false
  }

  const gross = flows.reduce((sum, flow) => sum + Math.abs(flow), 0)

  return Math.abs(flows.reduce((sum, flow) => sum + flow, 0)) < gross * CANCELLING_BOARD_FLOW_RATIO
}
