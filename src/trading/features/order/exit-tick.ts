import type { ExitSettleDeps } from '@/trading/features/order/exit-settle'
import type { RestingExit } from '@/trading/features/order/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { settleExitStatus, startFillNotice } from '@/trading/features/order/exit-settle'
import { buildPositionKey } from '@/trading/kernel/instrument'

/** How long the exchange may go on denying an exit it should know before it is treated as gone. A
 *  moment of it is a read that raced a fill; five minutes of it is an order that no longer exists.
 *  A duration rather than a count of passes, so the verdict does not move with the tick's cadence. */
const EXIT_MISSING_GRACE_MS = 300_000

interface ExitTickDeps extends ExitSettleDeps {
  readonly portfolio: Pick<PortfolioService, 'record' | 'positionsAt' | 'dayAt'>
  readonly batchSize: number
}

/** Rides the existing loop factory, so it owns no timer and no cadence: it holds a cursor in its
 *  closure and returns immediately when nothing rests. */
export function createExitTick(deps: ExitTickDeps): (signal: AbortSignal) => Promise<void> {
  let cursor: string | undefined

  return async (signal): Promise<void> => {
    const now = Date.now()
    const page = await deps.resting.listLive({
      limit: deps.batchSize,
      signal,
      ...(cursor === undefined ? {} : { cursor }),
    })

    if (page.items.length === 0) {
      cursor = undefined

      return
    }

    // One fold per pass, not per row: the book is the same for every exit on the page.
    const held = await heldQuantities(deps, now, signal)

    for (const exit of page.items) {
      await reconcileOne(deps, exit, { now, signal, held })
    }

    cursor = page.nextCursor
  }
}

interface TickPass {
  readonly now: number
  readonly signal: AbortSignal
  /** Booked quantity per position, for the divergence check. */
  readonly held: ReadonlyMap<string, number>
}

async function heldQuantities(
  deps: ExitTickDeps,
  now: number,
  signal: AbortSignal
): Promise<ReadonlyMap<string, number>> {
  const positions = await deps.portfolio.positionsAt({ now, signal })

  return new Map(
    positions.map((position) => [
      buildPositionKey(position.instrument, position.venue),
      position.quantity,
    ])
  )
}

/** One bad row must not stop the page, and a batch against a down exchange must not write one
 *  identical error per row — so the failure is logged once here and the loop continues. Only an
 *  abort ends the page: shutdown is no row's failure. */
async function reconcileOne(deps: ExitTickDeps, exit: RestingExit, pass: TickPass): Promise<void> {
  try {
    await reconcile(deps, exit, pass)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('order.exit_reconcile_failed', {
      exitClientId: exit.exitClientId,
      symbol: exit.symbol,
      err: formatErrForLog(err),
    })
  }
}

async function reconcile(deps: ExitTickDeps, exit: RestingExit, pass: TickPass): Promise<void> {
  const venue = deps.venues.find(exit.venue)

  // Never `markClosed`: the order may still be live at an exchange this process can no longer
  // reach, and closing the row would tell the operator their stop-loss is gone when it is not.
  // Never `markMissing` either — that stamp measures an exchange denying the order exists, which
  // is a different fact from this process being unable to ask. The row stays live.
  if (venue?.adapter === undefined) {
    deps.logger.warn('order.exit_venue_unknown', {
      exitClientId: exit.exitClientId,
      venue: exit.venue,
    })

    return
  }

  // A venue that rests no exit has nothing resting to reconcile; the registry refuses a method
  // under an undeclared capability, so the row this reads can only predate the manifest.
  if (venue.adapter.fetchExit === undefined) {
    return
  }

  const status = await venue.adapter.fetchExit({
    symbol: exit.symbol,
    exitClientId: exit.exitClientId,
    signal: pass.signal,
  })

  if (status === undefined) {
    await onMissing(deps, exit, pass)

    return
  }

  // The exchange named it, whatever it went on to say about it, so any run of denials behind this
  // reply is over and the next one opens its own window.
  if (exit.firstMissedAt !== undefined) {
    await deps.resting.clearMissing(exit.exitClientId, pass.signal)
  }

  if (status.state === 'live') {
    warnIfDiverged(deps, exit, pass.held)

    return
  }

  const settlement = await settleExitStatus(deps, exit, {
    status,
    now: pass.now,
    signal: pass.signal,
  })

  // Nothing to announce when the book already held the sale, e.g. from a `/record sync`.
  if (settlement.kind === 'sold' && settlement.notice !== undefined) {
    startFillNotice(deps, exit, { fill: settlement.notice, signal: pass.signal })
  }
}

/** Never cancels anything. A booked position that no longer covers a live exit is reported with
 *  both numbers and left alone: removing downside protection because a bookkeeping row changed is
 *  the automatic action this product refuses, and a mistyped `/record` must not be able to do it. */
function warnIfDiverged(
  deps: ExitTickDeps,
  exit: RestingExit,
  held: ReadonlyMap<string, number>
): void {
  const booked = held.get(buildPositionKey(exit.instrument, exit.venue)) ?? 0

  if (booked >= exit.quantity) {
    return
  }

  deps.logger.warn('order.exit_diverged', {
    exitClientId: exit.exitClientId,
    symbol: exit.symbol,
    resting: exit.quantity,
    booked,
  })
}

/** An unbroken run of explicit not-founds, never of failures: a failure throws and is logged by the
 *  caller, so an outage cannot age a live exit out of existence. */
async function onMissing(deps: ExitTickDeps, exit: RestingExit, pass: TickPass): Promise<void> {
  const { firstMissedAt } = exit

  if (firstMissedAt === undefined) {
    await deps.resting.markMissing({
      exitClientId: exit.exitClientId,
      at: pass.now,
      signal: pass.signal,
    })

    return
  }

  if (pass.now - firstMissedAt < EXIT_MISSING_GRACE_MS) {
    return
  }

  deps.logger.warn('order.exit_vanished', {
    exitClientId: exit.exitClientId,
    symbol: exit.symbol,
    missingForMs: pass.now - firstMissedAt,
  })
  await deps.resting.markClosed(exit.exitClientId, pass.signal)
}
