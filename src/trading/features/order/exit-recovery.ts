import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { RoutedVenue } from '@/trading/features/order/routing'
import type { ExitReceipt } from '@/trading/features/order/types'
import type { ExitStatus } from '@/trading/kernel/venue/spot-adapter'
import { formatErrForLog } from '@/core/security/credentials'
import { settleSignal } from '@/trading/features/order/mirror'
import { OrderError } from '@/trading/features/order/types'

interface RecoverExitInput {
  readonly venue: RoutedVenue
  readonly symbol: string
  readonly exitClientId: string
}

// A transport error says nothing about whether the exchange took the exit. A refusal can say the
// same: a retry after a crash places under the client id the first attempt used, and a venue
// answers that as a duplicate refusal, whose code is its own and not one this tree can match.
const UNSETTLED_CODES: ReadonlySet<string> = new Set(['order.network', 'order.rejected'])

/** One lookup by the deterministic client id answers whether the exchange took the exit: one found
 *  resting is adopted, so it gets its row, and anything else lets the original error stand. */
export async function recoverPlacedExit(
  deps: OrderServiceDeps,
  input: RecoverExitInput,
  cause: unknown
): Promise<ExitReceipt> {
  if (!(cause instanceof OrderError && UNSETTLED_CODES.has(cause.code))) {
    throw cause
  }

  const status = await lookupPlacedExit(deps, input)

  if (status?.state !== 'live' || status.exitId === undefined) {
    throw cause
  }

  deps.logger.warn('order.exit_recovered', {
    exitClientId: input.exitClientId,
    exitId: status.exitId,
    symbol: input.symbol,
    err: formatErrForLog(cause),
  })

  return { exitId: status.exitId, exitClientId: input.exitClientId }
}

async function lookupPlacedExit(
  deps: OrderServiceDeps,
  input: RecoverExitInput
): Promise<ExitStatus | undefined> {
  const fetchExit = input.venue.adapter.fetchExit

  if (fetchExit === undefined) {
    return undefined
  }

  try {
    return await fetchExit({
      symbol: input.symbol,
      exitClientId: input.exitClientId,
      signal: settleSignal(),
    })
  } catch (err: unknown) {
    deps.logger.error('order.exit_recovery_unreachable', {
      exitClientId: input.exitClientId,
      symbol: input.symbol,
      err: formatErrForLog(err),
    })

    return undefined
  }
}
