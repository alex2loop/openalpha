import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type {
  OrderService,
  UnmirroredIntent,
  UnmirroredReview,
} from '@/trading/features/order/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

/** How long a confirmation token stays quotable. Long enough to read the prompt and answer it,
 *  short enough that the quote it was measured against is still the same market. */
export const CONFIRM_TTL_MS = 300_000

type IntentDeps = Pick<OrderServiceDeps, 'intents' | 'findRecordedFill' | 'logger'>

/** The intent row's life either side of placing: claiming the token that authorizes an order, and
 *  settling one the exchange took that the book never got. Nothing here reaches a venue, which is
 *  what separates it from `execute.ts`. A row is cleared without asking only where the book can be
 *  shown to hold that exchange order already; everything else waits for the operator, because
 *  `unmirroredExposure` keeps charging it and that is what stops a lost fill being spent twice. */
export function createOrderIntents(
  deps: IntentDeps
): Pick<OrderService, 'claim' | 'reconcileUnmirrored' | 'clearUnmirrored'> {
  return {
    claim: async (input) => {
      await deps.intents.sweepExpired({ before: input.now - CONFIRM_TTL_MS, signal: input.signal })

      return await deps.intents.claim({
        token: input.token,
        notBefore: input.now - CONFIRM_TTL_MS,
        now: input.now,
        signal: input.signal,
      })
    },
    reconcileUnmirrored: (signal) => reconcileUnmirrored(deps, signal),
    clearUnmirrored: (token, signal) => deps.intents.clearUnmirrored(token, signal),
  }
}

async function reconcileUnmirrored(
  deps: IntentDeps,
  signal: AbortSignal
): Promise<UnmirroredReview> {
  const intents = await deps.intents.listUnmirrored(signal)
  const outstanding: UnmirroredIntent[] = []
  let settled = 0

  for (const intent of intents) {
    if (await settleRecovered(deps, intent, signal)) {
      settled += 1
      continue
    }

    outstanding.push(intent)
  }

  return { settled, outstanding }
}

/** A row the exchange never named an order for cannot be looked up, so it stays outstanding. One
 *  unreachable lookup leaves its row listed rather than failing the whole pass: a reconcile that
 *  shows nothing is worse than one that shows a row the operator could have cleared themselves. */
async function settleRecovered(
  deps: IntentDeps,
  intent: UnmirroredIntent,
  signal: AbortSignal
): Promise<boolean> {
  const { orderId } = intent

  if (orderId === undefined) {
    return false
  }

  try {
    if ((await deps.findRecordedFill(intent.venue, orderId, signal)) === undefined) {
      return false
    }

    return await deps.intents.clearUnmirrored(intent.token, signal)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('order.unmirrored_recheck_failed', {
      venue: intent.venue,
      orderId,
      err: formatErrForLog(err),
    })

    return false
  }
}
