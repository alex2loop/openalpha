import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { RestingExit } from '@/trading/features/order/types'
import type { Position } from '@/trading/kernel/operator/book'
import { buildPositionKey } from '@/trading/kernel/instrument'

/** Rows per page while walking the live exits. Every page is walked: a book that calls a position
 *  guarded because its exit happened to land on the first page is worse than one that says nothing. */
const EXIT_SCAN_ROWS = 100

/** The keyset cursor is the id of the last row returned and the order is ascending, so each page
 *  starts past the one before it and the walk terminates on the table it started against. */
export async function liveExits(
  deps: Pick<OrderServiceDeps, 'resting'>,
  signal: AbortSignal
): Promise<readonly RestingExit[]> {
  const exits: RestingExit[] = []
  let cursor: string | undefined

  do {
    const page = await deps.resting.listLive({
      limit: EXIT_SCAN_ROWS,
      signal,
      ...(cursor === undefined ? {} : { cursor }),
    })

    exits.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== undefined)

  return exits
}

/** Grouped rather than summed on the way in: coverage needs the total and the levels need to know
 *  whether there was exactly one row to read them from. */
export function exitsByPosition(
  exits: readonly RestingExit[]
): ReadonlyMap<string, readonly RestingExit[]> {
  const byPosition = new Map<string, RestingExit[]>()

  for (const exit of exits) {
    const key = buildPositionKey(exit.instrument, exit.venue)

    byPosition.set(key, [...(byPosition.get(key) ?? []), exit])
  }

  return byPosition
}

export function restingOn(
  byPosition: ReadonlyMap<string, readonly RestingExit[]>,
  position: Position
): readonly RestingExit[] {
  return byPosition.get(buildPositionKey(position.instrument, position.venue)) ?? []
}

export function guardedQuantityOf(resting: readonly RestingExit[]): number {
  return resting.reduce((total, exit) => total + exit.quantity, 0)
}
