import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/brief-context'
import type { UsBoard } from '@/trading/markets/equity-us/board'
import { absent, ready } from '@/trading/markets/brief-sections'
import { usBreadthAt } from '@/trading/markets/equity-us/breadth'
import { latestSession } from '@/trading/markets/equity-us/overview'
import { breadthTrendRows } from '@/trading/markets/overview-rollups'

/** The same rows `/overview` renders from the board's own read, so one session's breadth reads
 *  identically wherever the operator meets it. */
export function buildUsBreadth(context: BriefContext<UsBoard>): Promise<BriefSectionResult> {
  const { board } = context
  const session = board === null ? undefined : latestSession(board)
  const rows =
    board === null || session === undefined ? [] : breadthTrendRows(usBreadthAt(board, session))

  if (session === undefined || rows.length === 0) {
    return Promise.resolve(absent('breadth', [{ code: 'market-data.no-coverage' }]))
  }

  return Promise.resolve(ready('breadth', rows, { asOf: session }))
}
